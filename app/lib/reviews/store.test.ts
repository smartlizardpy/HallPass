/**
 * Tests for the review store factory.
 *
 * Same fake-`sql` seam as `moderation.test.ts`, `social/store.test.ts` and
 * `scoreboard/store.test.ts`: a function matching the tagged-template signature
 * records every call and returns canned rows, so the SHAPE of the emitted SQL
 * can be asserted without a database.
 *
 * This file starts narrow, covering `reportReview`, because that statement's
 * important properties live in the SQL text as well as in the return value. A
 * live-database test could observe that a self-report produced no row, but it
 * could not tell the difference between the guard being present and the insert
 * simply failing for some other reason, and it would pass just as happily if the
 * guard were moved into a second round trip (which the HTTP driver cannot make
 * transactional).
 *
 * The outcome mapping is tested from the other end — canned result rows in,
 * outcome out — because that is the half the report ROUTE reads, and answering
 * "filed" to a report that filed nothing is the specific bug that let reports
 * disappear silently between the button and the moderation queue.
 */

import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createReviewStore } from "./store";
import { REVIEW_AUTO_HIDE_REPORTS } from "./config";

interface RecordedCall {
  text: string;
  values: unknown[];
}

function makeFakeSql(
  rows: Record<string, unknown>[] = [{ found: 1, own: false, filed: 1 }],
) {
  const calls: RecordedCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

/** The three columns the report statement ends on, as the driver returns them. */
function reportRow(
  found: number,
  own: boolean,
  filed: number,
): Record<string, unknown> {
  return { found, own, filed };
}

describe("reportReview", () => {
  it("refuses to file a report against the reporter's own review", async () => {
    // Not a security control: auto-hide needs three DISTINCT reporters and the
    // dedup index caps one person at one report, so a self-report could never
    // hide anything. It is a noise control — the moderation queue's whole value
    // is being short enough that a human actually reads it, and an author who
    // wants their own review gone already has the delete button.
    const { sql, calls } = makeFakeSql([reportRow(1, true, 0)]);
    const store = createReviewStore(sql);

    expect(await store.reportReview(1, "player-1", "spam", null)).toBe("self");

    expect(calls).toHaveLength(1);
    const text = calls[0].text;
    // The guard compares the review's author to the reporter, in the same
    // statement as the insert...
    expect(text).toContain("game_reviews");
    expect(text).toMatch(/AS own/);
    expect(text).toContain("WHERE NOT t.own");
    // ...and it must be an INSERT ... SELECT, because a VALUES list has nowhere
    // to hang a WHERE clause and would force the check into a second statement.
    expect(text).toMatch(/INSERT INTO review_reports[\s\S]*SELECT/);
    expect(text).not.toMatch(/INSERT INTO review_reports\s*\([^)]*\)\s*VALUES/);
  });

  it("reports what actually happened, so nothing can answer ok for a report it dropped", async () => {
    // The whole point of the return value. Three of these four file no row, and
    // when they were indistinguishable the route thanked the reporter for a
    // report that never reached the queue.
    const cases: [Record<string, unknown>, string][] = [
      [reportRow(1, false, 1), "filed"],
      [reportRow(1, false, 0), "duplicate"],
      [reportRow(1, true, 0), "self"],
      [reportRow(0, false, 0), "missing"],
    ];

    for (const [row, expected] of cases) {
      const { sql } = makeFakeSql([row]);
      expect(await createReviewStore(sql).reportReview(1, "p", "spam", null)).toBe(
        expected,
      );
    }
  });

  it("reads the boolean whichever way the driver hands it back", async () => {
    // `own` is a Postgres boolean. The HTTP driver's type parsers return it as
    // `true`, but a raw-text path (or a fake `sql` here) yields 't' — and a
    // truthiness check on the string would call every outcome `self` while a
    // strict `=== true` would call every one of them a filed report. Both
    // spellings, one meaning.
    for (const own of [true, "t"]) {
      const { sql } = makeFakeSql([{ found: 1, own, filed: 0 }]);
      expect(await createReviewStore(sql).reportReview(1, "p", "spam", null)).toBe(
        "self",
      );
    }
  });

  it("still files, dedupes and auto-hides in ONE statement", async () => {
    // The three things that must not drift apart. If any of them moved into its
    // own round trip there would be a window where a report exists but the
    // review has not been re-counted, and auto-hide is the one behaviour that
    // has to be immediate — an abusive review sits in front of a class until
    // somebody acts.
    const { sql, calls } = makeFakeSql();
    const store = createReviewStore(sql);

    await store.reportReview(42, "reporter-9", "bullying", "ip-hash");

    expect(calls).toHaveLength(1);
    const { text, values } = calls[0];
    expect(text).toContain("ON CONFLICT (review_id, reporter_id) DO NOTHING");
    expect(text).toContain("UPDATE game_reviews");
    expect(text).toContain("'hidden'");
    // The threshold is bound, not inlined, so config and SQL cannot disagree.
    expect(values).toContain(REVIEW_AUTO_HIDE_REPORTS);
    expect(values).toContain(42);
    expect(values).toContain("reporter-9");
    expect(values).toContain("bullying");
    expect(values).toContain("ip-hash");
  });

  it("never interpolates a fragment — every input is a bound value", async () => {
    const { sql, calls } = makeFakeSql();
    const store = createReviewStore(sql);

    await store.reportReview(7, "'; DROP TABLE players; --", "spam", null);

    // The injection attempt rides in `values`, never in the statement text.
    expect(calls[0].text).not.toContain("DROP TABLE");
    expect(calls[0].values).toContain("'; DROP TABLE players; --");
  });
});

describe("visibleReviewBody", () => {
  it("selects the body of a VISIBLE review by id, as a bound value", async () => {
    // Scoped to status='visible' so a hidden or deleted review's text can never
    // be surfaced through the translate route.
    const { sql, calls } = makeFakeSql([{ body: "great game" }]);
    const store = createReviewStore(sql);

    const body = await store.visibleReviewBody(42);

    expect(body).toBe("great game");
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("FROM game_reviews");
    expect(calls[0].text).toContain("status = 'visible'");
    // The id is bound, never spliced.
    expect(calls[0].text).not.toContain("42");
    expect(calls[0].values).toContain(42);
  });

  it("returns null when no visible review matches", async () => {
    const { sql } = makeFakeSql([]);
    const store = createReviewStore(sql);

    expect(await store.visibleReviewBody(999)).toBeNull();
  });
});
