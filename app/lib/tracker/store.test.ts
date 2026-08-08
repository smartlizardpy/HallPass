/**
 * Tests for the tracker store factory.
 *
 * Same fake-`sql` seam as `reviews/store.test.ts`, `social/store.test.ts` and
 * `scoreboard/store.test.ts`: a function matching the tagged-template signature
 * records every call and returns canned rows, so the SHAPE of the emitted SQL
 * can be asserted without a database.
 *
 * That seam is the only way to test what actually matters here. The load-bearing
 * property of every mutation is that it is ONE statement — the row change and
 * its event written together — and a live-database test could not tell that
 * apart from two statements that both happened to succeed. The `neon()` HTTP
 * driver cannot make two calls transactional, so "one call" is the invariant,
 * and `calls.length` is how you check it.
 */

import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createTrackerStore } from "./store";
import { TERMINAL_STATUSES } from "./config";

interface RecordedCall {
  text: string;
  values: unknown[];
}

function makeFakeSql(rows: Record<string, unknown>[] = [{ id: 1 }]) {
  const calls: RecordedCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

describe("createItem", () => {
  it("writes the item, its tags and the create event in ONE statement", async () => {
    // If any of these moved into its own round trip there would be a window
    // where an item exists with no tags, or with no trace of who pasted it in.
    const { sql, calls } = makeFakeSql([{ id: 7 }]);
    const store = createTrackerStore(sql);

    const id = await store.createItem({
      title: "Dark mode",
      brief: "please",
      tags: ["ui", "theme"],
      actor: "a@b.c",
    });

    expect(id).toBe(7);
    expect(calls).toHaveLength(1);
    const { text, values } = calls[0];
    expect(text).toContain("INSERT INTO tracker_items");
    expect(text).toContain("INSERT INTO tracker_item_tags");
    expect(text).toContain("INSERT INTO tracker_events");
    // Tags ride as ONE comma-joined scalar, not a bound array.
    expect(values).toContain("ui,theme");
    expect(values).toContain("Dark mode");
    expect(values).toContain("a@b.c");
  });

  it("guards the no-tags case with nullif so an empty tag is never inserted", async () => {
    // `string_to_array('', ',')` yields one EMPTY-STRING element, which the
    // tracker_item_tags_format CHECK rejects — taking the whole insert, and the
    // brief somebody just pasted, down with it. nullif turns it into zero rows.
    const { sql, calls } = makeFakeSql([{ id: 1 }]);
    const store = createTrackerStore(sql);

    await store.createItem({ title: "t", brief: "", tags: [], actor: "a@b.c" });

    expect(calls[0].text).toContain("nullif(");
    expect(calls[0].text).toContain("string_to_array");
    expect(calls[0].values).toContain("");
  });

  it("returns null when the insert produced no row", async () => {
    const { sql } = makeFakeSql([]);
    const store = createTrackerStore(sql);
    expect(
      await store.createItem({ title: "t", brief: "", tags: [], actor: "a" }),
    ).toBeNull();
  });
});

describe("setStatus", () => {
  it("moves the item and logs the transition in ONE statement", async () => {
    const { sql, calls } = makeFakeSql([
      { from_status: "planned", changed: true },
    ]);
    const store = createTrackerStore(sql);

    const result = await store.setStatus(3, "building", "a@b.c");

    expect(result).toEqual({ from: "planned", changed: true });
    expect(calls).toHaveLength(1);
    const { text, values } = calls[0];
    expect(text).toContain("UPDATE tracker_items");
    expect(text).toContain("INSERT INTO tracker_events");
    expect(values).toContain("building");
    expect(values).toContain(3);
  });

  it("reads the previous status from a CTE, not a second query", async () => {
    // A CTE sees the statement's starting snapshot, so `from_value` is the
    // pre-update status with no extra round trip. Reading it afterwards would
    // return the NEW value and log 'building -> building'.
    const { sql, calls } = makeFakeSql([{ from_status: "new", changed: true }]);
    const store = createTrackerStore(sql);

    await store.setStatus(1, "building", "a@b.c");

    expect(calls[0].text).toMatch(/WITH prev AS \([\s\S]*SELECT id, status/);
    expect(calls[0].text).toContain("prev.status");
  });

  it("stamps started_at only the first time, and never re-stamps", async () => {
    // Bouncing an item in and out of `building` must not keep resetting when
    // work began.
    const { sql, calls } = makeFakeSql([{ from_status: "new", changed: true }]);
    const store = createTrackerStore(sql);

    await store.setStatus(1, "building", "a@b.c");

    expect(calls[0].text).toContain("t.started_at IS NULL");
  });

  it("binds the terminal statuses from config rather than inlining them", async () => {
    // The done_at CHECK in migration 021 enforces
    // `status IN ('shipped','declined') = (done_at IS NOT NULL)`. Binding the
    // set from config is what stops the SQL and the vocabulary disagreeing.
    const { sql, calls } = makeFakeSql([
      { from_status: "building", changed: true },
    ]);
    const store = createTrackerStore(sql);

    await store.setStatus(1, "shipped", "a@b.c");

    expect(calls[0].values).toContain(TERMINAL_STATUSES.join(","));
    // Leaving a terminal status must CLEAR the stamp, not keep it.
    expect(calls[0].text).toContain("ELSE NULL END");
  });

  it("distinguishes a no-op move from a missing item", async () => {
    // Both used to be zero rows, which showed an error for a double-submitted
    // form. A live item always returns a row; only a missing one returns none.
    const noop = makeFakeSql([{ from_status: "building", changed: false }]);
    expect(
      await createTrackerStore(noop.sql).setStatus(1, "building", "a"),
    ).toEqual({ from: "building", changed: false });

    const missing = makeFakeSql([]);
    expect(
      await createTrackerStore(missing.sql).setStatus(1, "building", "a"),
    ).toBeNull();

    expect(noop.calls[0].text).toContain("LEFT JOIN moved");
  });

  it("refuses to move an archived item", async () => {
    const { sql, calls } = makeFakeSql([{ from_status: "new", changed: true }]);
    const store = createTrackerStore(sql);
    await store.setStatus(1, "planned", "a@b.c");
    expect(calls[0].text).toContain("archived_at IS NULL");
  });
});

describe("setTags", () => {
  it("converges to exactly the given set in ONE statement", async () => {
    const { sql, calls } = makeFakeSql([{ id: 1 }]);
    const store = createTrackerStore(sql);

    const ok = await store.setTags(1, ["pwa", "perf"], "a@b.c");

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    const { text, values } = calls[0];
    expect(text).toContain("DELETE FROM tracker_item_tags");
    expect(text).toContain("INSERT INTO tracker_item_tags");
    expect(values).toContain("pwa,perf");
  });

  it("logs one event carrying the whole before/after, not one per tag", async () => {
    // "tags: a,b -> a,c" is what somebody reading the history wants, and it
    // keeps a five-tag edit from writing ten rows.
    const { sql, calls } = makeFakeSql([{ id: 1 }]);
    const store = createTrackerStore(sql);

    await store.setTags(1, ["a"], "a@b.c");

    expect(calls[0].text).toContain("'tag'");
    expect(calls[0].text).toContain("string_agg");
    expect((calls[0].text.match(/INSERT INTO tracker_events/g) ?? [])).toHaveLength(1);
  });

  it("keeps the wanted set NULL-free so NOT IN cannot silently match nothing", async () => {
    // A single NULL in `wanted` makes the whole NOT IN unknown, and the delete
    // quietly removes nothing. nullif is what keeps the empty case at zero rows
    // rather than one NULL row.
    const { sql, calls } = makeFakeSql([{ id: 1 }]);
    const store = createTrackerStore(sql);

    await store.setTags(1, [], "a@b.c");

    expect(calls[0].text).toContain("nullif(");
    expect(calls[0].text).toContain("NOT IN (SELECT tag FROM wanted)");
  });
});

describe("addUpdate", () => {
  it("writes the note, touches the item and logs, in ONE statement", async () => {
    const { sql, calls } = makeFakeSql([{ id: 9 }]);
    const store = createTrackerStore(sql);

    expect(await store.addUpdate(1, "halfway", "a@b.c")).toBe(9);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("INSERT INTO tracker_updates");
    expect(calls[0].text).toContain("UPDATE tracker_items");
    expect(calls[0].text).toContain("'comment'");
  });

  it("refuses to comment on an archived item", async () => {
    const { sql, calls } = makeFakeSql([{ id: 1 }]);
    await createTrackerStore(sql).addUpdate(1, "x", "a@b.c");
    expect(calls[0].text).toContain("archived_at IS NULL");
  });
});

describe("archive and restore", () => {
  it("archives softly and logs it in one statement", async () => {
    const { sql, calls } = makeFakeSql([{ id: 1 }]);
    const store = createTrackerStore(sql);

    expect(await store.archiveItem(1, "a@b.c")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("SET archived_at = now()");
    expect(calls[0].text).toContain("'archive'");
    // Never a hard delete: an item removed in error is one click from returning.
    expect(calls[0].text).not.toContain("DELETE FROM tracker_items");
  });

  it("restores only something actually archived", async () => {
    // Guarded so it cannot be reused as a general-purpose touch on a live item.
    const { sql, calls } = makeFakeSql([{ id: 1 }]);
    const store = createTrackerStore(sql);

    expect(await store.restoreItem(1, "a@b.c")).toBe(true);
    expect(calls[0].text).toContain("archived_at IS NOT NULL");
    expect(calls[0].text).toContain("SET archived_at = NULL");
  });

  it("reports false when nothing matched", async () => {
    const { sql } = makeFakeSql([]);
    const store = createTrackerStore(sql);
    expect(await store.archiveItem(1, "a")).toBe(false);
    expect(await store.restoreItem(1, "a")).toBe(false);
  });
});

describe("reads", () => {
  it("keeps the 20 000-character brief out of the board query", async () => {
    // The board renders a hundred cards, none of which show the brief.
    // Selecting it would pull megabytes over the wire to display nothing.
    const { sql, calls } = makeFakeSql([]);
    await createTrackerStore(sql).listBoard();
    expect(calls[0].text).not.toMatch(/\bi\.brief\b/);
    expect(calls[0].text).toContain("archived_at IS NULL");
  });

  it("fetches the brief for the one item being read", async () => {
    const { sql, calls } = makeFakeSql([]);
    await createTrackerStore(sql).getItem(1);
    expect(calls[0].text).toContain("i.brief");
  });

  it("maps a row into a card, splitting the aggregated tags", async () => {
    const { sql } = makeFakeSql([
      {
        id: "12",
        title: "Dark mode",
        status: "planned",
        created_by: "a@b.c",
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-02T00:00:00Z",
        tags: "theme,ui",
        update_count: "3",
        last_update_at: "2026-08-03T00:00:00Z",
      },
    ]);

    const [card] = await createTrackerStore(sql).listBoard();

    // BIGINT arrives as a string from the HTTP driver; ids must not stay strings.
    expect(card.id).toBe(12);
    expect(card.updateCount).toBe(3);
    expect(card.tags).toEqual(["theme", "ui"]);
    expect(card.createdAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("reads an untagged item as an empty list, not [''] ", async () => {
    const { sql } = makeFakeSql([
      {
        id: "1",
        title: "t",
        status: "new",
        created_by: "a",
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
        tags: null,
        update_count: "0",
        last_update_at: null,
      },
    ]);

    const [card] = await createTrackerStore(sql).listBoard();

    expect(card.tags).toEqual([]);
    expect(card.lastUpdateAt).toBeNull();
  });

  it("derives the tag list from live items only", async () => {
    const { sql, calls } = makeFakeSql([]);
    await createTrackerStore(sql).listTags();
    expect(calls[0].text).toContain("SELECT DISTINCT");
    expect(calls[0].text).toContain("archived_at IS NULL");
  });
});
