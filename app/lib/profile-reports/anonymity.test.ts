/**
 * Locks in the owner's decision that REPORTERS STAY ANONYMOUS to moderators (and
 * to the reported player): no dashboard, queue, notification or MCP surface may
 * carry who filed a profile report. The id stays in the table (for rate limits
 * and the ON DELETE SET NULL rule) and in the audit of nothing else.
 *
 * Each assertion is on the surface itself, not on this module's good intentions:
 * the queue's SQL and output shape, the dashboard card's source, the
 * notification text, the action's log line, and the MCP analytics views.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createProfileReportStore } from "./store";
import { profileReportedCopy } from "@/app/lib/notifications/copy";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Source with comments removed, so a docblock saying "never the reporter" is not a hit. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function fakeSql(rows: Record<string, unknown>[]) {
  const calls: string[] = [];
  const fn = (strings: TemplateStringsArray) => {
    calls.push(strings.join("?"));
    return Promise.resolve(rows);
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

describe("reporters are never shown to moderators", () => {
  it("the queue neither selects nor returns the reporter", async () => {
    // Even if a row somehow carried reporter columns, the mapper drops them.
    const { sql, calls } = fakeSql([
      {
        id: 1,
        reason: "bullying",
        note: "n",
        created_at: "2026-01-01T00:00:00Z",
        public_id: "00000000-0000-4000-8000-000000000001",
        username: null,
        handle: null,
        open_against: 1,
        reporter_id: "google-reporter-subject",
        reporter_name: "Ayşe Yılmaz",
        reporter_email: "ayse@school.test",
      },
    ]);
    const out = await createProfileReportStore(sql).queue({ limit: 10 });
    expect(JSON.stringify(out)).not.toMatch(/google-reporter-subject|Ayşe|school\.test|reporter/i);
    expect(Object.keys(out[0]).sort()).toEqual(
      ["createdAt", "id", "note", "openAgainstPlayer", "reason", "reported"].sort(),
    );
    expect(calls[0]).not.toMatch(/reporter/i);
  });

  it("the dashboard card and its actions never touch reporter data", () => {
    const page = code("app/dashboard/(app)/moderation/page.tsx");
    const card = page.slice(page.indexOf("function ProfileReportCard"), page.indexOf("function QueueCard"));
    expect(card.length).toBeGreaterThan(500);
    // The card may SAY the reporter is hidden; it must not read reporter data.
    expect(card).not.toMatch(/reporter_?id|reporterId|reporterName|reporterEmail|\.reporter\b/i);
    const actions = code("app/dashboard/(app)/moderation/actions.ts");
    const profile = actions.slice(actions.indexOf("async function resolveProfileReport"));
    expect(profile).not.toMatch(/reporter/i);
  });

  it("the admin notification names no reporter and no reported player", () => {
    for (const reason of ["bullying", "other", "unknown"]) {
      const copy = profileReportedCopy({ reason });
      expect(JSON.stringify(copy)).not.toMatch(/reporter|google|@/i);
    }
  });

  it("no MCP analytics view exposes profile reports", () => {
    expect(read("app/lib/mcp/analytics/schema.sql")).not.toMatch(/profile_reports/);
    for (const file of ["bugs.ts", "tracker.ts", "surveys.ts", "server.ts"]) {
      expect(read(`app/lib/mcp/${file}`)).not.toMatch(/profile_reports|profileReports/);
    }
  });
});
