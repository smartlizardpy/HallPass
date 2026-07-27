/**
 * Tests for the review moderation store factory.
 *
 * Same fake-`sql` seam as `social/store.test.ts` and `scoreboard/store.test.ts`:
 * a function matching the tagged-template signature records every call and returns
 * canned rows, so both the JS-side decoding and the SHAPE of the emitted SQL can
 * be asserted without a database.
 *
 * That matters more here than anywhere else in the repo, because the properties
 * this module has to hold are properties of the emitted statement rather than of
 * its return value:
 *
 *   * every mutation carries its audit row IN THE SAME statement — a live-DB test
 *     could only observe the two rows afterwards and would pass just as happily
 *     against two separate round trips, which is the exact failure mode
 *     (mutation lands, log does not) the design exists to rule out;
 *   * the queue never SELECTS an email — a "does the result contain an email"
 *     assertion passes trivially on seed data that has none, whereas asserting on
 *     the query text catches the careless `p.email` the moment it is written;
 *   * `ban()` branches in JS into two whole templates, and branch selection is
 *     invisible from the outside.
 */

import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createModerationStore } from "./moderation";

interface RecordedCall {
  text: string;
  values: unknown[];
}

function makeFakeSql(responder: (call: RecordedCall) => Record<string, unknown>[]) {
  const calls: RecordedCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call: RecordedCall = { text: strings.join("?"), values };
    calls.push(call);
    return Promise.resolve(responder(call));
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

const ACTOR = "mod@school.test";

/** One scalar row permissive enough to satisfy every write's decoder. */
function writeRow(over: Record<string, unknown> = {}) {
  return {
    found: 1,
    changed: 1,
    reports_closed: 2,
    dismissed: 1,
    banned: 1,
    hidden: 0,
    removed: 1,
    ...over,
  };
}

/** A queue row as the driver would hand it back. */
function queueRow(over: Record<string, unknown> = {}) {
  return {
    id: 42,
    slug: "duskfall",
    body: "this game is broken",
    status: "hidden",
    recommended: false,
    created_at: "2026-07-01T10:00:00.000Z",
    helpful_count: 3,
    report_count: 4,
    public_id: "11111111-2222-3333-4444-555555555555",
    username: "ozan",
    handle: "Ozan",
    image: "https://example.test/a.png",
    author_banned: false,
    open_count: 2,
    newest_report_at: "2026-07-02T09:00:00.000Z",
    reports: [
      {
        id: 7,
        reason: "bullying",
        created_at: "2026-07-02T09:00:00.000Z",
        reporter_public_id: "99999999-8888-7777-6666-555555555555",
        reporter_handle: null,
        reporter_username: "sam",
      },
    ],
    ...over,
  };
}

describe("queue", () => {
  it("NEVER selects an email column — not the author's, not the reporter's", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    await createModerationStore(sql).queue();
    // The single most tempting leak in the codebase. `players.email` is a child's
    // school address; a column never selected cannot be spread into a client
    // component by a later refactor.
    expect(calls[0].text).not.toMatch(/email/i);
  });

  it("is ONE round trip, aggregating the reports with json_agg", async () => {
    const { sql, calls } = makeFakeSql(() => [queueRow()]);
    await createModerationStore(sql).queue();
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("json_agg");
    // Grouped BEFORE the join, or count(*) would count the join product.
    expect(calls[0].text).toContain("GROUP BY rp.review_id");
    expect(calls[0].text).toContain("WHERE rp.status = 'open'");
  });

  it("orders by newest report and carries the ban state", async () => {
    const { sql, calls } = makeFakeSql(() => [queueRow({ author_banned: true })]);
    const [entry] = await createModerationStore(sql).queue();
    expect(calls[0].text).toContain("ORDER BY q.newest_report_at DESC");
    // So the UI does not offer "ban" to someone already banned.
    expect(entry.author.banned).toBe(true);
    expect(calls[0].text).toContain("review_bans");
  });

  it("does not filter on review status — auto-hidden and tombstoned rows belong here", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    await createModerationStore(sql).queue();
    expect(calls[0].text).not.toContain("r.status =");
  });

  it("projects the author publicly: public_id, no subject id, no email, no real name", async () => {
    const { sql } = makeFakeSql(() => [
      queueRow({
        // Fields a careless projection might carry through:
        player_id: "google-subject-id",
        email: "child@school.test",
        name: "Real Name",
      }),
    ]);
    const [entry] = await createModerationStore(sql).queue();
    expect(entry.author.id).toBe("11111111-2222-3333-4444-555555555555");
    const json = JSON.stringify(entry);
    expect(json).not.toContain("google-subject-id");
    expect(json).not.toContain("child@school.test");
    expect(json).not.toContain("Real Name");
  });

  it("falls back @username then Player for author and reporter alike", async () => {
    const { sql } = makeFakeSql(() => [
      queueRow({
        handle: null,
        reports: [
          {
            id: 7,
            reason: "spam",
            created_at: "2026-07-02T09:00:00.000Z",
            // Orphaned reporter: reporter_id is ON DELETE SET NULL, so the row
            // outlives the account that filed it.
            reporter_public_id: null,
            reporter_handle: null,
            reporter_username: null,
          },
        ],
      }),
    ]);
    const [entry] = await createModerationStore(sql).queue();
    expect(entry.author.displayName).toBe("@ozan");
    expect(entry.reports[0].reporter).toEqual({ id: null, displayName: "Player" });
  });

  it("decodes json_agg whether the driver parsed it or handed back the string", async () => {
    const parsed = queueRow();
    const { sql } = makeFakeSql(() => [
      { ...parsed, reports: JSON.stringify(parsed.reports) },
    ]);
    const [entry] = await createModerationStore(sql).queue();
    expect(entry.reports).toHaveLength(1);
    expect(entry.reports[0]).toEqual({
      id: 7,
      reason: "bullying",
      createdAt: "2026-07-02T09:00:00.000Z",
      reporter: {
        id: "99999999-8888-7777-6666-555555555555",
        displayName: "@sam",
      },
    });
  });

  it("clamps the limit in JS — LIMIT NULL would mean no limit at all", async () => {
    const store = createModerationStore(makeFakeSql(() => []).sql);
    expect(store).toBeTruthy();

    const a = makeFakeSql(() => []);
    await createModerationStore(a.sql).queue();
    expect(a.calls[0].values).toContain(50);

    const b = makeFakeSql(() => []);
    await createModerationStore(b.sql).queue({ limit: 9999 });
    expect(b.calls[0].values).toContain(200);

    const c = makeFakeSql(() => []);
    await createModerationStore(c.sql).queue({ limit: Number.NaN });
    expect(c.calls[0].values).toContain(50);
  });
});

describe("recentActions", () => {
  it("breaks ties on id — a ban and its hide_backlog share one now()", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    await createModerationStore(sql).recentActions();
    expect(calls[0].text).toContain("ORDER BY l.created_at DESC, l.id DESC");
  });

  it("resolves the target to public identity and never returns players.id", async () => {
    const { sql } = makeFakeSql(() => [
      {
        id: 5,
        actor_email: ACTOR,
        action: "ban",
        review_id: 42,
        slug: "duskfall",
        reason: "repeated bullying",
        created_at: "2026-07-02T09:00:00.000Z",
        has_target: true,
        public_id: "11111111-2222-3333-4444-555555555555",
        handle: "Ozan",
        username: "ozan",
        player_id: "google-subject-id",
      },
    ]);
    const [entry] = await createModerationStore(sql).recentActions();
    expect(entry.target).toEqual({
      id: "11111111-2222-3333-4444-555555555555",
      displayName: "Ozan",
    });
    // The acting ADMIN's address is the point of an audit trail; the PLAYER's
    // subject id is what must not travel.
    expect(entry.actorEmail).toBe(ACTOR);
    expect(JSON.stringify(entry)).not.toContain("google-subject-id");
  });

  it("distinguishes 'no target' from 'target whose account is gone'", async () => {
    const base = {
      id: 5,
      actor_email: ACTOR,
      action: "unban",
      review_id: null,
      slug: null,
      reason: null,
      created_at: "2026-07-02T09:00:00.000Z",
      public_id: null,
      handle: null,
      username: null,
    };
    const none = makeFakeSql(() => [{ ...base, has_target: false }]);
    expect((await createModerationStore(none.sql).recentActions())[0].target).toBeNull();

    // The ban row deliberately has no FK, so it outlives the players row.
    const gone = makeFakeSql(() => [{ ...base, has_target: true }]);
    expect((await createModerationStore(gone.sql).recentActions())[0].target).toEqual({
      id: null,
      displayName: "Deleted player",
    });
  });
});

describe("openReportCount", () => {
  it("counts open reports off the partial index", async () => {
    const { sql, calls } = makeFakeSql(() => [{ n: 12 }]);
    expect(await createModerationStore(sql).openReportCount()).toBe(12);
    expect(calls[0].text).toContain("WHERE status = 'open'");
  });
});

describe("internalIdFromPublicId", () => {
  it("rejects a malformed UUID before it reaches Postgres", async () => {
    // A bad uuid cast raises 22P02, turning a bad request into a 500.
    const { sql, calls } = makeFakeSql(() => []);
    expect(await createModerationStore(sql).internalIdFromPublicId("nope")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("resolves a well-formed one", async () => {
    const { sql } = makeFakeSql(() => [{ id: "google-subject-id" }]);
    expect(
      await createModerationStore(sql).internalIdFromPublicId(
        "11111111-2222-3333-4444-555555555555",
      ),
    ).toBe("google-subject-id");
  });
});

describe("every write carries its audit row in the same statement", () => {
  const writes: Array<[string, string, (s: ReturnType<typeof createModerationStore>) => Promise<unknown>]> = [
    ["hide", "'hide'", (s) => s.hide(42, ACTOR, "bullying")],
    ["unhide", "'unhide'", (s) => s.unhide(42, ACTOR)],
    ["softDelete", "'delete'", (s) => s.softDelete(42, ACTOR)],
    ["purge", "'purge'", (s) => s.purge(42, ACTOR, "phone number")],
    ["dismissReport", "'dismiss'", (s) => s.dismissReport(7, ACTOR)],
    ["dismissAllFromReporter", "'dismiss'", (s) => s.dismissAllFromReporter("p1", ACTOR)],
    ["ban", "'ban'", (s) => s.ban("p1", ACTOR)],
    ["ban+hideBacklog", "'hide_backlog'", (s) => s.ban("p1", ACTOR, { hideBacklog: true })],
    ["unban", "'unban'", (s) => s.unban("p1", ACTOR)],
  ];

  for (const [name, action, run] of writes) {
    it(`${name} emits exactly one statement, inserting ${action}`, async () => {
      const { sql, calls } = makeFakeSql(() => [writeRow()]);
      await run(createModerationStore(sql));
      // One statement, because `neon()` is SQL-over-HTTP: two calls could not
      // share a transaction, so a second call is a window in which the mutation
      // has landed and the log row has not.
      expect(calls).toHaveLength(1);
      expect(calls[0].text).toContain("INSERT INTO review_moderation_log");
      expect(calls[0].text).toContain(action);
    });

    it(`${name} binds the actor rather than splicing it`, async () => {
      const { sql, calls } = makeFakeSql(() => [writeRow()]);
      await run(createModerationStore(sql));
      // The tagged template parameterises VALUES only; a spliced fragment would
      // appear in the text and would be an injection point.
      expect(calls[0].text).not.toContain(ACTOR);
      expect(calls[0].values).toContain(ACTOR);
    });
  }
});

describe("hide", () => {
  it("closes every open report on the review, in the same statement", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow()]);
    const result = await createModerationStore(sql).hide(42, ACTOR, "bullying");
    expect(calls[0].text).toContain("UPDATE review_reports");
    expect(calls[0].text).toContain("status = 'actioned'");
    expect(calls[0].text).toContain("resolved_by = ");
    // This is what makes the queue throughput-bounded rather than volume-bounded.
    expect(result.reportsClosed).toBe(2);
  });

  it("moves only a visible review and stamps status_changed_at", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow()]);
    await createModerationStore(sql).hide(42, ACTOR);
    expect(calls[0].text).toContain("SET status = 'hidden', status_changed_at = now()");
    // Not `<> 'hidden'`: a 'deleted' tombstone must never be rewritten, or the
    // record that the AUTHOR removed it is lost.
    expect(calls[0].text).toContain("AND status = 'visible'");
  });

  it("reports 'already hidden' honestly while still draining the queue", async () => {
    // The auto-hide case: three reporters got there first, so the status does not
    // move but the moderator has still adjudicated the reports.
    const { sql } = makeFakeSql(() => [writeRow({ changed: 0, reports_closed: 3 })]);
    expect(await createModerationStore(sql).hide(42, ACTOR)).toEqual({
      found: true,
      changed: false,
      reportsClosed: 3,
    });
  });

  it("reports not-found without claiming success", async () => {
    const { sql } = makeFakeSql(() => [
      writeRow({ found: 0, changed: 0, reports_closed: 0 }),
    ]);
    expect(await createModerationStore(sql).hide(42, ACTOR)).toEqual({
      found: false,
      changed: false,
      reportsClosed: 0,
    });
  });
});

describe("unhide", () => {
  it("resets report_count so one later report cannot re-trigger auto-hide", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow()]);
    await createModerationStore(sql).unhide(42, ACTOR);
    // Leaving it at 3+ would hand a single griefer a veto over a decision a human
    // already made. The report ROWS survive as the record.
    expect(calls[0].text).toContain("report_count = 0");
    expect(calls[0].text).toContain("AND status = 'hidden'");
  });

  it("closes the open reports too", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow()]);
    const result = await createModerationStore(sql).unhide(42, ACTOR);
    expect(calls[0].text).toContain("status = 'actioned'");
    expect(result.reportsClosed).toBe(2);
  });
});

describe("softDelete", () => {
  it("tombstones rather than deleting, and logs the enumerated 'delete' action", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow()]);
    await createModerationStore(sql).softDelete(42, ACTOR, "hate");
    expect(calls[0].text).toContain("SET status = 'deleted'");
    expect(calls[0].text).not.toContain("DELETE FROM game_reviews");
    expect(calls[0].text).toContain("'delete'");
    expect(calls[0].values).toContain("hate");
  });

  it("closes the open reports", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow()]);
    expect((await createModerationStore(sql).softDelete(42, ACTOR)).reportsClosed).toBe(2);
    expect(calls[0].text).toContain("UPDATE review_reports");
  });
});

describe("purge", () => {
  it("really deletes, and logs from the pre-delete snapshot", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow()]);
    await createModerationStore(sql).purge(42, ACTOR, "phone number");
    expect(calls[0].text).toContain("DELETE FROM game_reviews");
    // The log has no FK to game_reviews, precisely so the trail survives the row.
    expect(calls[0].text).toContain("INSERT INTO review_moderation_log");
    expect(calls[0].text).toContain("'purge'");
  });

  it("closes reports by cascade rather than updating rows it is about to delete", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow({ reports_closed: 5 })]);
    const result = await createModerationStore(sql).purge(42, ACTOR);
    expect(calls[0].text).not.toContain("UPDATE review_reports");
    // Counted from the pre-delete snapshot — the honest number.
    expect(result.reportsClosed).toBe(5);
  });
});

describe("dismissReport", () => {
  it("marks the REPORT wrong, not the review, and only while open", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow()]);
    expect(await createModerationStore(sql).dismissReport(7, ACTOR)).toBe(true);
    expect(calls[0].text).toContain("SET status = 'dismissed'");
    expect(calls[0].text).toContain("AND status = 'open'");
    expect(calls[0].text).not.toContain("UPDATE game_reviews");
  });

  it("returns false when the report was already resolved", async () => {
    const { sql } = makeFakeSql(() => [writeRow({ dismissed: 0 })]);
    expect(await createModerationStore(sql).dismissReport(7, ACTOR)).toBe(false);
  });
});

describe("dismissAllFromReporter", () => {
  it("returns the count and writes ONE bulk log row, not one per report", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow({ dismissed: 12 })]);
    expect(await createModerationStore(sql).dismissAllFromReporter("p1", ACTOR)).toBe(12);
    expect(calls[0].text).toContain("WHERE reporter_id = ");
    expect(calls[0].text).toContain("bulk dismissal of ");
    // Identifiable in the log as player_id set with review_id NULL.
    expect(calls[0].text).toContain(
      "INSERT INTO review_moderation_log (actor_email, action, player_id, reason)",
    );
  });

  it("writes no log row when the reporter had nothing open", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow({ dismissed: 0 })]);
    expect(await createModerationStore(sql).dismissAllFromReporter("p1", ACTOR)).toBe(0);
    expect(calls[0].text).toContain("WHERE EXISTS (SELECT 1 FROM upd)");
  });
});

describe("ban", () => {
  it("defaults hideBacklog OFF and leaves the player's other reviews alone", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow()]);
    const result = await createModerationStore(sql).ban("p1", ACTOR, {
      reason: "repeated bullying",
    });
    // The whole point of the default: a ban usually follows ONE bad review, and
    // mass-hiding a term's worth of harmless ones destroys the context the next
    // moderator needs.
    expect(calls[0].text).not.toContain("UPDATE game_reviews");
    expect(calls[0].text).not.toContain("hide_backlog");
    expect(result).toEqual({ banned: true, backlogHidden: 0 });
  });

  it("selects the other template when hideBacklog is on, with a SEPARATE log entry", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow({ hidden: 6 })]);
    const result = await createModerationStore(sql).ban("p1", ACTOR, {
      hideBacklog: true,
    });
    expect(calls[0].text).toContain("UPDATE game_reviews");
    expect(calls[0].text).toContain("WHERE player_id = ");
    expect(calls[0].text).toContain("AND status = 'visible'");
    expect(calls[0].text).toContain("'hide_backlog'");
    expect(result).toEqual({ banned: true, backlogHidden: 6 });
  });

  it("leaves the backlog's open reports OPEN — nobody read those reviews", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow({ hidden: 6 })]);
    await createModerationStore(sql).ban("p1", ACTOR, { hideBacklog: true });
    // Unlike hide(): marking them adjudicated would claim a human judged content
    // the bulk action never showed anyone.
    expect(calls[0].text).not.toContain("UPDATE review_reports");
  });

  it("upserts so a re-ban replaces the old expiry instead of keeping it", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow()]);
    await createModerationStore(sql).ban("p1", ACTOR, {});
    // DO NOTHING here would silently keep a 7-day ban when an admin escalated to
    // permanent — the most likely quiet failure of this feature.
    expect(calls[0].text).toContain("ON CONFLICT (player_id) DO UPDATE");
    expect(calls[0].text).toContain("expires_at = EXCLUDED.expires_at");
  });

  it("binds a NULL expiry for a permanent ban and an ISO string otherwise", async () => {
    const permanent = makeFakeSql(() => [writeRow()]);
    await createModerationStore(permanent.sql).ban("p1", ACTOR);
    expect(permanent.calls[0].values).toContain(null);
    // Explicitly cast, or an untyped NULL parameter cannot be resolved.
    expect(permanent.calls[0].text).toContain("::timestamptz");

    const timed = makeFakeSql(() => [writeRow()]);
    await createModerationStore(timed.sql).ban("p1", ACTOR, {
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(timed.calls[0].values).toContain("2026-08-01T00:00:00.000Z");
  });

  it("records the ban against the INTERNAL player id, which has no FK to survive", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow()]);
    await createModerationStore(sql).ban("google-subject-id", ACTOR);
    expect(calls[0].text).toContain("INSERT INTO review_bans");
    expect(calls[0].values).toContain("google-subject-id");
  });
});

describe("unban", () => {
  it("deletes the row — the row IS the ban — and logs it", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow()]);
    expect(await createModerationStore(sql).unban("p1", ACTOR)).toBe(true);
    expect(calls[0].text).toContain("DELETE FROM review_bans");
    expect(calls[0].text).toContain("'unban'");
  });

  it("does NOT restore reviews hidden by a backlog hide", async () => {
    const { sql, calls } = makeFakeSql(() => [writeRow()]);
    await createModerationStore(sql).unban("p1", ACTOR);
    // "You may write again" is not "everything you wrote was fine".
    expect(calls[0].text).not.toContain("game_reviews");
  });

  it("returns false when there was no ban to lift", async () => {
    const { sql } = makeFakeSql(() => [writeRow({ removed: 0 })]);
    expect(await createModerationStore(sql).unban("p1", ACTOR)).toBe(false);
  });
});
