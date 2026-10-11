/**
 * The profile-reports store against the fake-`sql` seam `invites/store.test.ts`
 * uses: every operation is ONE statement, caller input is only ever a bound
 * value, outcomes map correctly, and the queue carries public names only.
 */

import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createProfileReportStore } from "./store";
import {
  NOTE_MAX_CHARS,
  PROFILE_REPORT_RETENTION_DAYS,
  REPORT_DAILY_LIMIT,
  REPORT_HOURLY_LIMIT,
  isProfileReportReason,
  parseNote,
} from "./config";

function makeFakeSql(rows: Record<string, unknown>[] = []) {
  const calls: { text: string; values: unknown[] }[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

const INPUT = {
  reporterId: "google-reporter",
  reportedPublicId: "00000000-0000-4000-8000-000000000001",
  reason: "bullying" as const,
  note: "ignore this ' ; DROP TABLE players; --",
};

describe("create", () => {
  it("is one statement and binds every caller value", async () => {
    const { sql, calls } = makeFakeSql([{ found: 1, is_self: false, hourly: 0, daily: 0, inserted: 1 }]);
    const out = await createProfileReportStore(sql).create(INPUT);
    expect(out).toEqual({ result: "created" });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).not.toContain("DROP TABLE");
    expect(calls[0].values).toContain(INPUT.note);
    expect(calls[0].values).toContain(INPUT.reportedPublicId);
    expect(calls[0].values).toContain(REPORT_HOURLY_LIMIT.maxPerWindow);
    expect(calls[0].values).toContain(REPORT_DAILY_LIMIT.maxPerWindow);
    expect(calls[0].text).toMatch(/ON CONFLICT \(reporter_id, reported_id\) WHERE status = 'open' DO NOTHING/);
    expect(calls[0].text).toMatch(/t\.id <> /);
  });

  it("maps an unknown profile, self, rate limit and duplicate", async () => {
    const run = async (row: Record<string, unknown>) =>
      createProfileReportStore(makeFakeSql([row]).sql).create(INPUT);
    expect(await run({ found: 0, is_self: false, hourly: 0, daily: 0, inserted: 0 })).toEqual({ result: "unknown" });
    expect(await run({ found: 1, is_self: true, hourly: 0, daily: 0, inserted: 0 })).toEqual({ result: "self" });
    expect(
      await run({ found: 1, is_self: false, hourly: String(REPORT_HOURLY_LIMIT.maxPerWindow), daily: 0, inserted: 0 }),
    ).toEqual({ result: "rate-limited" });
    expect(
      await run({ found: 1, is_self: false, hourly: 0, daily: REPORT_DAILY_LIMIT.maxPerWindow, inserted: 0 }),
    ).toEqual({ result: "rate-limited" });
    expect(await run({ found: 1, is_self: false, hourly: 1, daily: 1, inserted: 0 })).toEqual({ result: "duplicate" });
  });
});

describe("queue", () => {
  it("maps public names only and never selects email or the Google name", async () => {
    const { sql, calls } = makeFakeSql([
      {
        id: "7",
        reason: "inappropriate_name",
        note: null,
        created_at: "2026-01-02T03:04:05Z",
        public_id: "00000000-0000-4000-8000-000000000001",
        username: "sam_h",
        handle: null,
        open_against: "3",
      },
    ]);
    const out = await createProfileReportStore(sql).queue({ limit: 50 });
    expect(out).toEqual([
      {
        id: 7,
        reason: "inappropriate_name",
        note: null,
        createdAt: "2026-01-02T03:04:05.000Z",
        reported: { publicId: "00000000-0000-4000-8000-000000000001", username: "sam_h", displayName: "@sam_h" },
        openAgainstPlayer: 3,
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).not.toMatch(/\bemail\b/i);
    expect(calls[0].text).not.toMatch(/p\.name\b/);
    expect(calls[0].text).not.toMatch(/reporter/);
    expect(calls[0].text).toMatch(/status = 'open'/);
  });
});

describe("resolve", () => {
  it("is one statement that only touches open reports", async () => {
    const { sql, calls } = makeFakeSql([{ found: true, changed: "1" }]);
    const out = await createProfileReportStore(sql).resolve({ id: 4, status: "dismissed", actorEmail: "a@b.c" });
    expect(out).toEqual({ found: true, changed: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/status = 'open'/);
    expect(calls[0].values).toEqual(expect.arrayContaining([4, "dismissed", "a@b.c"]));
  });

  it("separates stale from already-closed", async () => {
    const store = (row: Record<string, unknown>) => createProfileReportStore(makeFakeSql([row]).sql);
    expect(await store({ found: false, changed: "0" }).resolve({ id: 1, status: "actioned", actorEmail: "x" })).toEqual({
      found: false,
      changed: false,
    });
    expect(await store({ found: true, changed: "0" }).resolve({ id: 1, status: "actioned", actorEmail: "x" })).toEqual({
      found: true,
      changed: false,
    });
  });
});

describe("actionAccount", () => {
  it("is one statement that clears the identity, tombstones the name and closes every open report", async () => {
    const { sql, calls } = makeFakeSql([{ found: true, closed: "2", cleared: "1", tombstoned: "1", public_id: "pid" }]);
    const out = await createProfileReportStore(sql).actionAccount({ id: 7, actorEmail: "admin@x.test" });
    expect(out).toEqual({ found: true, changed: true, reportsClosed: 2, publicId: "pid" });
    expect(calls).toHaveLength(1);
    const text = calls[0].text.replace(/\s+/g, " ");
    expect(text).toMatch(/SET handle = NULL, username = NULL, use_google_photo = false/);
    expect(text).toMatch(/SET status = 'actioned', resolved_at = now\(\)/);
    expect(text).toMatch(/WHERE reported_id = \(SELECT reported_id FROM rep\) AND status = 'open'/);
    expect(text).toMatch(/INSERT INTO username_history/);
    expect(calls[0].values).toEqual([7, "admin@x.test", 7]);
  });

  it("changes nothing for a stale or already-closed report", async () => {
    const run = (row: Record<string, unknown>) =>
      createProfileReportStore(makeFakeSql([row]).sql).actionAccount({ id: 1, actorEmail: "a" });
    expect(await run({ found: false, closed: 0, public_id: null })).toMatchObject({ found: false, changed: false });
    expect(await run({ found: true, closed: 0, public_id: null })).toMatchObject({ found: true, changed: false });
  });
});

describe("purgeResolved", () => {
  it("is one DELETE of resolved rows only, bound to the day count", async () => {
    const { sql, calls } = makeFakeSql([{ n: "3" }]);
    const out = await createProfileReportStore(sql).purgeResolved(90);
    expect(out).toEqual({ deleted: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/DELETE FROM profile_reports/);
    expect(calls[0].text).toMatch(/status <> 'open'/);
    expect(calls[0].text).toMatch(/resolved_at < now\(\)/);
    expect(calls[0].values).toEqual([90]);
  });

  it("counts what is due for a dry run without deleting", async () => {
    const { sql, calls } = makeFakeSql([{ n: 2 }]);
    expect(await createProfileReportStore(sql).countPurgeable(90)).toBe(2);
    expect(calls[0].text).not.toMatch(/DELETE/);
  });

  it("keeps the documented retention", () => {
    expect(PROFILE_REPORT_RETENTION_DAYS).toBe(90);
  });
});

describe("config helpers", () => {
  it("validates reasons", () => {
    expect(isProfileReportReason("bullying")).toBe(true);
    expect(isProfileReportReason("hate")).toBe(false);
    expect(isProfileReportReason(undefined)).toBe(false);
  });

  it("parses notes", () => {
    expect(parseNote(undefined)).toBeNull();
    expect(parseNote("   ")).toBeNull();
    expect(parseNote("  hi\u0000 there ")).toBe("hi there");
    expect(parseNote(5)).toBeUndefined();
    expect(parseNote("x".repeat(NOTE_MAX_CHARS))).toHaveLength(NOTE_MAX_CHARS);
    expect(parseNote("x".repeat(NOTE_MAX_CHARS + 1))).toBeUndefined();
  });
});
