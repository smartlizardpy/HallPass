/**
 * Tests for the flair store factory.
 *
 * Same fake-`sql` seam as `reviews/store.test.ts` and `social/store.test.ts`: a
 * function matching the tagged-template signature records every call and returns
 * canned rows, so the SHAPE of the emitted SQL — and the way each method decodes
 * its `RETURNING` — is asserted without a database.
 */

import { describe, expect, it, vi } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";

// `flair-store.ts` imports the shared `sql` from `@/app/lib/db`, which begins with
// `import "server-only"` — a module that throws outside an RSC bundle. Stubbing it
// to an empty module lets the factory (and its live binding) import under `node`,
// exactly as `profile.test.ts` does. The fake `sql` seam means no live query runs.
vi.mock("server-only", () => ({}));

import { createFlairStore } from "./flair-store";

interface RecordedCall {
  text: string;
  values: unknown[];
}

function makeFakeSql(rows: Record<string, unknown>[] = []) {
  const calls: RecordedCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

describe("grantFlair", () => {
  it("inserts with an ON CONFLICT no-op and binds the five values in order", async () => {
    const { sql, calls } = makeFakeSql([{ id: 1 }]);
    const store = createFlairStore(sql);

    const outcome = await store.grantFlair(
      "player-1",
      { label: "Beta Tester", icon: "🧪", tone: "gold" },
      "admin@example.com",
    );

    expect(outcome).toBe("granted");
    expect(calls).toHaveLength(1);
    const { text, values } = calls[0];
    expect(text).toContain("INSERT INTO player_flair");
    // Idempotent on the (player_id, label) unique index, never a stacked pill.
    expect(text).toContain("ON CONFLICT (player_id, label) DO NOTHING");
    expect(text).toContain("RETURNING id");
    expect(values).toEqual([
      "player-1",
      "Beta Tester",
      "🧪",
      "gold",
      "admin@example.com",
    ]);
  });

  it("reports a duplicate when the insert returns no row", async () => {
    // ON CONFLICT DO NOTHING yields zero rows when the player already holds the
    // label — the store turns that into "duplicate", not a thrown error.
    const { sql } = makeFakeSql([]);
    const store = createFlairStore(sql);

    const outcome = await store.grantFlair(
      "player-1",
      { label: "Staff", icon: null, tone: "brand" },
      "admin@example.com",
    );

    expect(outcome).toBe("duplicate");
  });
});

describe("revokeFlair", () => {
  it("deletes by id and returns true when a row was removed", async () => {
    const { sql, calls } = makeFakeSql([{ id: 9 }]);
    const store = createFlairStore(sql);

    const removed = await store.revokeFlair(9);

    expect(removed).toBe(true);
    expect(calls[0].text).toContain("DELETE FROM player_flair WHERE id =");
    expect(calls[0].text).toContain("RETURNING id");
    expect(calls[0].values).toEqual([9]);
  });

  it("returns false for an unknown id", async () => {
    const { sql } = makeFakeSql([]);
    const store = createFlairStore(sql);
    expect(await store.revokeFlair(123)).toBe(false);
  });
});

describe("listRecentFlair", () => {
  it("joins players, never selects the subject id, and maps display names", async () => {
    const { sql, calls } = makeFakeSql([
      {
        id: 5,
        label: "Founder",
        icon: "🏛️",
        tone: "gold",
        granted_by: "admin@example.com",
        created_at: "2026-07-01T00:00:00.000Z",
        username: "sam_h",
        handle: null,
      },
      {
        id: 6,
        label: "Staff",
        icon: null,
        tone: "brand",
        granted_by: "admin@example.com",
        created_at: "2026-07-02T00:00:00.000Z",
        username: null,
        handle: "Coach",
      },
    ]);
    const store = createFlairStore(sql);

    const grants = await store.listRecentFlair(10);

    const { text, values } = calls[0];
    expect(text).toContain("FROM player_flair f");
    expect(text).toContain("JOIN players p ON p.id = f.player_id");
    // The Google subject id must NOT be in the SELECT projection — the row's own
    // id is the revoke handle. (`p.id` in the JOIN condition is expected.)
    const projection = text.slice(text.indexOf("SELECT"), text.indexOf("FROM"));
    expect(projection).not.toContain("p.id");
    expect(text).toContain("ORDER BY f.created_at DESC");
    expect(values).toEqual([10]);

    // A player with a username but no handle displays as "@username"; one with a
    // handle displays the handle.
    expect(grants[0]).toMatchObject({
      id: 5,
      label: "Founder",
      tone: "gold",
      username: "sam_h",
      displayName: "@sam_h",
      grantedBy: "admin@example.com",
    });
    expect(grants[1]).toMatchObject({
      id: 6,
      username: null,
      displayName: "Coach",
    });
  });
});
