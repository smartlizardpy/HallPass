/**
 * Tests for the beta programme store factory.
 *
 * Same fake-`sql` seam as `achievements/store.test.ts`, `reviews/store.test.ts`
 * and `social/store.test.ts`: a function matching the tagged-template signature
 * records every call and returns canned rows, so both the JS-side decoding and
 * the SHAPE of the emitted SQL can be asserted without a database.
 *
 * Several invariants here live ENTIRELY in the SQL text and so are tested
 * structurally — the clause that enforces each one must be present, verbatim, in
 * the statement that is sent:
 *
 *   * Triage and shot review are guarded on their pre-state (`status = 'open'` /
 *     `status = 'pending'`). Without it, a decision made against a stale queue
 *     would re-pay XP for a report someone else already closed.
 *   * The XP insert selects FROM the update's CTE, so it cannot fire when the
 *     update matched nothing.
 *   * `ON CONFLICT … DO NOTHING` against the partial unique indexes makes a
 *     double-submitted admin form idempotent.
 *   * The admin queue joins only PUBLIC player columns — a query that cannot
 *     select `players.email` cannot leak one into serialised props.
 *
 * A refactor that tidies any of those away fails here rather than months later
 * as a tester who was paid twice, or an email in a page's flight data.
 */

// No `vi.mock("server-only")`, deliberately: `store.ts` must not import it at
// all. Binding the live connection is `index.ts`'s job, and keeping the factory
// free of it is what makes this file possible.
import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createBetaStore } from "./store";
import {
  REASON_BUG_PREFIX,
  REASON_DUPLICATE,
  REASON_FEATURE_ACCEPTED,
  REASON_FIXED,
} from "./config";

interface RecordedCall {
  text: string;
  values: unknown[];
}

function makeFakeSql(
  responder: (call: RecordedCall) => Record<string, unknown>[] = () => [],
) {
  const calls: RecordedCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call: RecordedCall = { text: strings.join("?"), values };
    calls.push(call);
    return Promise.resolve(responder(call));
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

/** Collapse whitespace so assertions can be written as readable one-liners. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("invite requests", () => {
  it("infers the PARTIAL unique index, so a second ask is a no-op", async () => {
    const { sql, calls } = makeFakeSql();
    await createBetaStore(sql).requestInvite({
      playerId: "p1",
      requestedBy: "beta@example.com",
      note: "found three bugs as a player",
    });
    const text = flat(calls[0].text);
    // Without the WHERE predicate Postgres cannot match the partial index and
    // the statement errors outright; with a plain `ON CONFLICT (player_id)` it
    // would match no index at all.
    expect(text).toContain("ON CONFLICT (player_id) WHERE status = 'pending'");
    expect(text).toContain("DO NOTHING");
    // The caller distinguishes "filed" from "already waiting" by the row count,
    // so the RETURNING is load-bearing rather than decorative.
    expect(text).toContain("RETURNING id");
    expect(calls[0].values).toContain("p1");
  });

  it("reports whether the request was actually filed", async () => {
    const filed = makeFakeSql(() => [{ id: 1 }]);
    await expect(
      createBetaStore(filed.sql).requestInvite({
        playerId: "p1",
        requestedBy: "beta@example.com",
        note: "",
      }),
    ).resolves.toBe(true);

    const conflicted = makeFakeSql(() => []);
    await expect(
      createBetaStore(conflicted.sql).requestInvite({
        playerId: "p1",
        requestedBy: "beta@example.com",
        note: "",
      }),
    ).resolves.toBe(false);
  });

  it("only decides a request that is still pending", async () => {
    for (const status of ["approved", "denied"] as const) {
      const { sql, calls } = makeFakeSql(() => [{ id: 7 }]);
      const applied = await createBetaStore(sql).decideInviteRequest({
        id: 7,
        status,
        decidedBy: "admin@example.com",
      });
      // Same guard as triage's `status = 'open'`: two admins working the queue
      // must not both be told they decided it.
      expect(flat(calls[0].text)).toContain("AND status = 'pending'");
      expect(flat(calls[0].text)).toContain(`SET status = '${status}'`);
      expect(applied).toBe(true);
    }
  });

  it("says so when someone else decided first", async () => {
    const { sql } = makeFakeSql(() => []);
    await expect(
      createBetaStore(sql).decideInviteRequest({
        id: 7,
        status: "approved",
        decidedBy: "admin@example.com",
      }),
    ).resolves.toBe(false);
  });

  it("never selects a player email into the approval queue", async () => {
    const { sql, calls } = makeFakeSql();
    await createBetaStore(sql).inviteRequests();
    // Same rule as the roster: a query that cannot return an address cannot leak
    // one into a page's serialised props.
    expect(flat(calls[0].text)).not.toContain("email");
    expect(flat(calls[0].text)).toContain("ORDER BY (r.status = 'pending') DESC");
  });
});

describe("membership", () => {
  it("reinstates on re-invite instead of no-opping", async () => {
    const { sql, calls } = makeFakeSql();
    await createBetaStore(sql).invite("p1", "admin@example.com");
    // Without `revoked_at = NULL` a re-invite appears to succeed while leaving
    // the tester locked out.
    expect(flat(calls[0].text)).toContain("DO UPDATE SET revoked_at = NULL");
    expect(calls[0].values).toContain("p1");
  });

  it("only revokes a membership that is currently active", async () => {
    const { sql, calls } = makeFakeSql();
    await createBetaStore(sql).revoke("p1");
    expect(flat(calls[0].text)).toContain("revoked_at IS NULL");
  });

  it("distinguishes never-a-tester from revoked", async () => {
    const none = makeFakeSql(() => []);
    expect(await createBetaStore(none.sql).tester("p1")).toBeNull();

    const revoked = makeFakeSql(() => [
      {
        player_id: "p1",
        invited_by: "a@b.c",
        invited_at: "2026-01-01T00:00:00Z",
        revoked_at: "2026-02-01T00:00:00Z",
        notes: "",
      },
    ]);
    const row = await createBetaStore(revoked.sql).tester("p1");
    expect(row).not.toBeNull();
    expect(row!.revokedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("treats a revoked row as inactive", async () => {
    const { sql } = makeFakeSql(() => [
      {
        player_id: "p1",
        invited_by: null,
        invited_at: "2026-01-01T00:00:00Z",
        revoked_at: "2026-02-01T00:00:00Z",
        notes: "",
      },
    ]);
    expect(await createBetaStore(sql).isActiveTester("p1")).toBe(false);
  });

  it("never selects an email onto the roster", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    await createBetaStore(sql).roster();
    expect(calls[0].text).not.toContain("email");
  });

  it("counts removed reports from the ledger, not only live rows", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    await createBetaStore(sql).roster();
    const text = flat(calls[0].text);

    // Without this the counts go DOWN when a report is fixed or closed as a
    // duplicate — a tester's record shrinking as a reward for finding something
    // worth acting on.
    expect(text).toContain("beta_xp_awards");
    // `report_id IS NULL` is what stops a LIVE report being counted twice: once
    // as a row, once via the award still pointing at it.
    expect(text).toContain("a.shot_id IS NULL AND a.report_id IS NULL");
  });

  it("keeps the roster's reason predicates in step with config", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    await createBetaStore(sql).roster();
    const text = flat(calls[0].text);

    // The SQL cannot import from `config.ts`, so the strings are duplicated into
    // the query by hand. Renaming a reason code without updating the query would
    // silently stop counting — this is the only thing that would catch it.
    expect(text).toContain(`'${REASON_FIXED}'`);
    expect(text).toContain(`'${REASON_DUPLICATE}'`);
    expect(text).toContain(`a.reason LIKE '${REASON_BUG_PREFIX}%'`);
    expect(text).toContain(`a.reason = '${REASON_FEATURE_ACCEPTED}'`);
  });
});

describe("assignments", () => {
  it("upserts on (player_id, slug) rather than stacking duplicates", async () => {
    const { sql, calls } = makeFakeSql();
    await createBetaStore(sql).assign({
      playerId: "p1",
      slug: "pixel-slicer",
      assignedBy: "a@b.c",
      brief: "check touch controls",
    });
    const text = flat(calls[0].text);
    expect(text).toContain("ON CONFLICT (player_id, slug) DO UPDATE");
    // Re-assigning a closed game must mean "look again", so it reopens.
    expect(text).toContain("status = 'assigned'");
    expect(text).toContain("completed_at = NULL");
  });

  it("stamps completed_at only for terminal statuses", async () => {
    for (const status of ["submitted", "closed"] as const) {
      const { sql, calls } = makeFakeSql();
      await createBetaStore(sql).setAssignmentStatus(1, status);
      expect(flat(calls[0].text)).toContain("completed_at = now()");
    }
    for (const status of ["assigned", "in_progress"] as const) {
      const { sql, calls } = makeFakeSql();
      await createBetaStore(sql).setAssignmentStatus(1, status);
      expect(flat(calls[0].text)).toContain("completed_at = NULL");
    }
  });

  it("decodes an unknown status to a safe default", async () => {
    const { sql } = makeFakeSql(() => [
      {
        id: 1,
        player_id: "p1",
        slug: "s",
        assigned_by: null,
        brief: "",
        status: "not-a-status",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        completed_at: null,
      },
    ]);
    const [row] = await createBetaStore(sql).assignmentsFor("p1");
    expect(row.status).toBe("assigned");
  });
});

describe("triageReport", () => {
  it("guards on the open state and pays from the update's CTE", async () => {
    const { sql, calls } = makeFakeSql(() => [{ id: 7 }]);
    const applied = await createBetaStore(sql).triageReport({
      id: 7,
      status: "accepted",
      severity: "major",
      resolvedBy: "a@b.c",
      xp: 75,
      reason: "bug:major",
    });

    expect(applied).toBe(true);
    expect(calls).toHaveLength(1); // one statement, no read-modify-write
    const text = flat(calls[0].text);
    expect(text).toContain("WHERE id = ? AND status = 'open'");
    // The award can only fire when the update matched.
    expect(text).toContain("FROM updated");
    // Keyed on (report_id, reason), not report_id alone, so a report can carry
    // its acceptance award AND a later fix bonus. A repeat of the SAME decision
    // still collides, because `reason` is derived from the report either way.
    expect(text).toContain(
      "ON CONFLICT (report_id, reason) WHERE report_id IS NOT NULL DO NOTHING",
    );
    expect(text).toContain("WHERE player_id IS NOT NULL");
  });

  it("writes no ledger row at all when nothing is owed", async () => {
    const { sql, calls } = makeFakeSql(() => [{ id: 7 }]);
    await createBetaStore(sql).triageReport({
      id: 7,
      status: "rejected",
      severity: null,
      resolvedBy: "a@b.c",
      xp: 0,
      reason: "rejected",
    });
    const text = flat(calls[0].text);
    // A zero-value award row would clutter the tester's history for no reason.
    expect(text).not.toContain("beta_xp_awards");
    expect(text).toContain("status = 'open'");
  });

  it("reports a stale decision as not applied", async () => {
    const { sql } = makeFakeSql(() => []); // update matched nothing
    const applied = await createBetaStore(sql).triageReport({
      id: 7,
      status: "accepted",
      severity: "minor",
      resolvedBy: "a@b.c",
      xp: 30,
      reason: "bug:minor",
    });
    expect(applied).toBe(false);
  });

  it("keeps the existing severity when none is supplied", async () => {
    const { sql, calls } = makeFakeSql(() => [{ id: 7 }]);
    await createBetaStore(sql).triageReport({
      id: 7,
      status: "duplicate",
      severity: null,
      resolvedBy: "a@b.c",
      xp: 5,
      reason: "duplicate",
    });
    // COALESCE, not a blind overwrite — closing a bug as duplicate must not
    // erase the severity someone already assessed.
    expect(flat(calls[0].text)).toContain("severity = COALESCE(?, severity)");
  });
});

describe("payAndRemoveReport", () => {
  const input = {
    id: 7,
    resolvedBy: "a@b.c",
    awards: [
      { amount: 75, reason: "bug:major" },
      { amount: 50, reason: "fixed" },
    ],
  };

  it("PAYS BEFORE IT DELETES", async () => {
    // The single most important property in this file. Without a transaction,
    // either statement can land alone. Paid-then-not-deleted self-heals: the
    // report is still in the queue, a retry conflicts away on the unique index
    // and the delete completes. Deleted-then-not-paid is unrecoverable — the
    // row is gone, the tester is unpaid, and there is nothing left to click.
    const { sql, calls } = makeFakeSql(() => [{ id: 7, clip_blob_path: null }]);
    await createBetaStore(sql).payAndRemoveReport(input);

    expect(calls).toHaveLength(2);
    expect(flat(calls[0].text)).toContain("INSERT INTO beta_xp_awards");
    expect(flat(calls[1].text)).toContain("DELETE FROM beta_reports");
  });

  it("is two statements and NOT one CTE", async () => {
    // Deliberately not the usual data-modifying CTE. Inserting the awards and
    // deleting the report in one statement races the FK's ON DELETE SET NULL,
    // which fires at end of statement and would null the pointers on the rows
    // just written.
    const { sql, calls } = makeFakeSql(() => [{ id: 7, clip_blob_path: null }]);
    await createBetaStore(sql).payAndRemoveReport(input);
    expect(flat(calls[0].text)).not.toContain("DELETE");
  });

  it("refuses a rejected report in SQL, not only in the action", async () => {
    const { sql, calls } = makeFakeSql(() => [{ id: 7, clip_blob_path: null }]);
    await createBetaStore(sql).payAndRemoveReport(input);
    for (const call of calls) {
      expect(flat(call.text)).toContain("status <> 'rejected'");
    }
  });

  it("dedupes both awards on (report_id, reason)", async () => {
    const { sql, calls } = makeFakeSql(() => [{ id: 7, clip_blob_path: null }]);
    await createBetaStore(sql).payAndRemoveReport(input);
    expect(flat(calls[0].text)).toContain(
      "ON CONFLICT (report_id, reason) WHERE report_id IS NOT NULL DO NOTHING",
    );
  });

  it("writes no zero-value ledger line for an unused award slot", async () => {
    const { sql, calls } = makeFakeSql(() => [{ id: 7, clip_blob_path: null }]);
    // One award, as Duplicate passes. The second slot is padded to zero and must
    // vanish rather than leaving a worthless line in the tester's history.
    await createBetaStore(sql).payAndRemoveReport({
      ...input,
      awards: [{ amount: 5, reason: "duplicate" }],
    });
    // The filter is in SQL rather than in the caller, so a 0 can never reach the
    // ledger regardless of which action assembles the input.
    expect(flat(calls[0].text)).toContain("a.amount > 0");
    expect(calls[0].values).toContain(5);
    expect(calls[0].values).toContain("duplicate");
    // The padded slot is present as a parameter but worth nothing.
    expect(calls[0].values).toContain(0);
  });

  it("pays a single award without needing a second", async () => {
    const { sql, calls } = makeFakeSql(() => [{ id: 7, clip_blob_path: null }]);
    const result = await createBetaStore(sql).payAndRemoveReport({
      ...input,
      awards: [{ amount: 5, reason: "duplicate" }],
    });
    expect(result.applied).toBe(true);
    expect(calls).toHaveLength(2); // still pay-then-delete
  });

  it("does not delete when the report was already gone", async () => {
    const { sql, calls } = makeFakeSql(() => []); // target matched nothing
    const result = await createBetaStore(sql).payAndRemoveReport(input);
    expect(result.applied).toBe(false);
    // Crucially it stops after the first statement — it must not fall through
    // and delete a report it did not pay for.
    expect(calls).toHaveLength(1);
  });

  it("returns the clip path from the DELETE, not from a prior read", async () => {
    const { sql } = makeFakeSql((call) =>
      call.text.includes("DELETE")
        ? [{ clip_blob_path: "beta-clips/7.webm" }]
        : [{ id: 7 }],
    );
    const result = await createBetaStore(sql).payAndRemoveReport(input);
    expect(result).toEqual({ applied: true, clipBlobPath: "beta-clips/7.webm" });
  });
});

describe("reviewShot", () => {
  it("guards on pending and dedupes per (shot, reason)", async () => {
    const { sql, calls } = makeFakeSql(() => [{ id: "s1" }]);
    await createBetaStore(sql).reviewShot({
      id: "s1",
      status: "accepted",
      reviewedBy: "a@b.c",
      xp: 15,
      reason: "shot:accepted",
    });
    const text = flat(calls[0].text);
    expect(text).toContain("WHERE id = ? AND status = 'pending'");
    // reason is part of the index so a LATER cover promotion can pay again.
    expect(text).toContain("ON CONFLICT (shot_id, reason) WHERE shot_id IS NOT NULL DO NOTHING");
  });

  it("skips the ledger entirely for a rejection", async () => {
    const { sql, calls } = makeFakeSql(() => [{ id: "s1" }]);
    await createBetaStore(sql).reviewShot({
      id: "s1",
      status: "rejected",
      reviewedBy: "a@b.c",
      xp: 0,
      reason: "rejected",
    });
    expect(flat(calls[0].text)).not.toContain("beta_xp_awards");
  });
});

describe("clips", () => {
  it("scopes an attach to the author so a guessed id cannot be hijacked", async () => {
    const { sql, calls } = makeFakeSql();
    await createBetaStore(sql).attachClip({
      reportId: 1,
      playerId: "p1",
      blobPath: "beta-clips/1.webm",
      bytes: 10,
      ms: 20,
    });
    expect(flat(calls[0].text)).toContain("WHERE id = ? AND player_id = ?");
  });

  it("only sweeps rows that still have an object", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    await createBetaStore(sql).expiredClips(30);
    expect(flat(calls[0].text)).toContain("clip_blob_path IS NOT NULL");
  });

  it("clamps a nonsense retention window to at least one day", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    await createBetaStore(sql).expiredClips(-5);
    // Otherwise a bad config value would delete every clip ever recorded.
    expect(calls[0].values).toContain(1);
  });
});

describe("decoding", () => {
  it("sums an empty ledger to zero rather than NULL", async () => {
    const { sql, calls } = makeFakeSql(() => [{ xp: null }]);
    expect(await createBetaStore(sql).xpFor("p1")).toBe(0);
    expect(flat(calls[0].text)).toContain("COALESCE(sum(amount), 0)");
  });

  it("normalises timestamps to ISO strings", async () => {
    const { sql } = makeFakeSql(() => [
      {
        id: 1,
        amount: "75",
        reason: "bug:major",
        report_id: "7",
        shot_id: null,
        created_at: "2026-01-02 03:04:05+00",
      },
    ]);
    const [award] = await createBetaStore(sql).awardsFor("p1");
    expect(award.createdAt).toBe("2026-01-02T03:04:05.000Z");
    // BIGINT and count(*) arrive as strings from the driver.
    expect(award.amount).toBe(75);
    expect(award.reportId).toBe(7);
  });

  it("clamps list limits so a caller cannot request a table scan", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    const store = createBetaStore(sql);
    await store.reportsFor("p1", 1_000_000);
    expect(calls[0].values).toContain(200);
    await store.reportQueue(1_000_000);
    expect(calls[1].values).toContain(500);
    await store.awardsFor("p1", 0);
    expect(calls[2].values).toContain(1);
  });

  it("never lets a manual award go negative", async () => {
    const { sql, calls } = makeFakeSql();
    await createBetaStore(sql).award({
      playerId: "p1",
      amount: -50,
      reason: "oops",
      awardedBy: "a@b.c",
    });
    expect(calls[0].values).toContain(0);
  });
});

describe("reportByIdWithAuthor", () => {
  it("fetches ONE row rather than scanning the queue for it", async () => {
    const { sql, calls } = makeFakeSql(() => [{ id: 7, kind: "bug", status: "open" }]);
    await createBetaStore(sql).reportByIdWithAuthor(7);
    const text = flat(calls[0].text);
    expect(calls).toHaveLength(1);
    expect(text).toContain("WHERE r.id =");
    // No LIMIT and no ORDER BY: this is a primary-key lookup, not a page of the
    // queue narrowed down after the fact.
    expect(text).not.toContain("ORDER BY");
    expect(calls[0].values).toContain(7);
  });

  /**
   * The same invariant the admin queue is held to: a query that cannot select
   * `players.email` cannot leak one into serialised props.
   */
  it("joins only PUBLIC player columns", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    await createBetaStore(sql).reportByIdWithAuthor(1);
    const text = flat(calls[0].text);
    expect(text).toContain("p.username AS author_username");
    expect(text).toContain("p.handle AS author_handle");
    expect(text).toContain("p.name AS author_name");
    expect(text).not.toContain("email");
  });

  /**
   * `player_id` is ON DELETE SET NULL, so a report outlives its author. An INNER
   * join would silently drop exactly those reports — and an orphaned report is
   * still a real bug somebody filed.
   */
  it("LEFT joins, so an orphaned report is still returned", async () => {
    const { sql, calls } = makeFakeSql(() => []);
    await createBetaStore(sql).reportByIdWithAuthor(1);
    expect(flat(calls[0].text)).toContain("LEFT JOIN players p ON p.id = r.player_id");
  });

  it("is null when no such report exists", async () => {
    const { sql } = makeFakeSql(() => []);
    await expect(createBetaStore(sql).reportByIdWithAuthor(99)).resolves.toBeNull();
  });
});

/**
 * The agent activity trail.
 *
 * Several invariants live entirely in the SQL text, so they are tested
 * structurally:
 *
 *   * The sweep is part of the INSERT's statement. Splitting it into a second
 *     call would double the round trips on every tool call an agent makes, and
 *     the `neon()` driver would not run the pair in one transaction anyway.
 *   * So is the reset of a quiet run, for a sharper reason: only on the
 *     insert's own snapshot does "has anything been written lately?" leave out
 *     the line being written.
 *   * `ORDER BY created_at DESC` is what the recent index serves. A read that
 *     ordered any other way would silently seq-scan a table that grows with
 *     every tool call.
 *
 * The caps are tested behaviourally: this is a LOGGING path, and a summary one
 * character over the CHECK must not turn into a failed tool call for the agent
 * that wrote it.
 */
describe("agent activity", () => {
  it("inserts and sweeps in ONE statement", async () => {
    const { sql, calls } = makeFakeSql();
    await createBetaStore(sql).logAgentActivity({
      actor: "mcp@hallpass.invalid",
      tool: "mark_bug_report_fixed",
      outcome: "ok",
      reportId: 42,
      slug: "neon-snake",
      summary: "Report 42 marked fixed",
      retainDays: 14,
      idleMinutes: 30,
    });
    expect(calls).toHaveLength(1);
    const text = flat(calls[0].text);
    expect(text).toContain("WITH logged AS ( INSERT INTO beta_agent_activity");
    expect(text).toContain("DELETE FROM beta_agent_activity WHERE created_at <");
  });

  /**
   * A run that ended without `finish_agent_activity` is reset by the first line
   * of the next one, and that has to happen in the SAME statement: on one
   * snapshot the NOT EXISTS cannot see the line being written, so it asks
   * whether the previous run went quiet, and the DELETE cannot remove the new
   * line either.
   */
  it("resets a quiet run in the statement that starts the next one", async () => {
    const { sql, calls } = makeFakeSql();
    await createBetaStore(sql).logAgentActivity({
      actor: "a",
      tool: "list_bug_reports",
      outcome: "ok",
      summary: "Listed 3 reports (open)",
      retainDays: 14,
      idleMinutes: 30,
    });
    expect(calls).toHaveLength(1);
    expect(flat(calls[0].text)).toContain(
      "OR NOT EXISTS ( SELECT 1 FROM beta_agent_activity WHERE created_at > now() - make_interval(mins => ?) )",
    );
    // Position 7 is the idle window, after the six VALUES and the retention.
    expect(calls[0].values[7]).toBe(30);
  });

  it("floors the idle window to a whole minute, and never to zero", async () => {
    const { sql, calls } = makeFakeSql();
    const store = createBetaStore(sql);
    const line = { actor: "a", tool: "t", outcome: "ok", summary: "s", retainDays: 14 };
    // A fraction would fail `make_interval`'s integer cast, and zero would reset
    // the feed on every line.
    await store.logAgentActivity({ ...line, idleMinutes: 12.7 });
    await store.logAgentActivity({ ...line, idleMinutes: 0 });
    expect(calls[0].values[7]).toBe(12);
    expect(calls[1].values[7]).toBe(1);
  });

  it("truncates an over-long summary rather than failing the CHECK", async () => {
    const { sql, calls } = makeFakeSql();
    await createBetaStore(sql).logAgentActivity({
      actor: "a",
      tool: "log_agent_activity",
      outcome: "ok",
      summary: "x".repeat(500),
      retainDays: 14,
      idleMinutes: 30,
    });
    expect(calls[0].values).toContain("x".repeat(300));
  });

  it("writes nothing at all for a blank summary", async () => {
    const { sql, calls } = makeFakeSql();
    await createBetaStore(sql).logAgentActivity({
      actor: "a",
      tool: "log_agent_activity",
      outcome: "ok",
      summary: "   ",
      retainDays: 14,
      idleMinutes: 30,
    });
    expect(calls).toHaveLength(0);
  });

  it("nulls a report id that is not a positive integer", async () => {
    const { sql, calls } = makeFakeSql();
    await createBetaStore(sql).logAgentActivity({
      actor: "a",
      tool: "get_bug_report",
      outcome: "ok",
      reportId: -3,
      summary: "read something",
      retainDays: 14,
      idleMinutes: 30,
    });
    // Position 3 is `report_id` in the VALUES list. A negative id would fail the
    // CHECK, and failing a LOG write is not worth failing a tool call over.
    expect(calls[0].values[3]).toBeNull();
  });

  it("reads newest first, which is what the recent index serves", async () => {
    const { sql, calls } = makeFakeSql(() => [
      {
        id: "7",
        actor: "mcp@hallpass.invalid",
        tool: "list_bug_reports",
        outcome: "ok",
        report_id: null,
        slug: null,
        summary: "Listed the open queue",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const rows = await createBetaStore(sql).recentAgentActivity({ limit: 5, idleMinutes: 30 });
    expect(flat(calls[0].text)).toContain("ORDER BY created_at DESC, id DESC");
    expect(rows[0]).toMatchObject({ id: 7, tool: "list_bug_reports", reportId: null });
  });

  /**
   * The panel closes because this read answers nothing once the run has gone
   * quiet. It is judged in SQL, by the database's clock, so a browser whose
   * clock is off can neither hold a dead run open nor close a live one.
   */
  it("answers nothing once the run has gone quiet", async () => {
    const { sql, calls } = makeFakeSql();
    await createBetaStore(sql).recentAgentActivity({ limit: 5, idleMinutes: 30 });
    expect(flat(calls[0].text)).toContain(
      "WHERE EXISTS ( SELECT 1 FROM beta_agent_activity WHERE created_at > now() - make_interval(mins => ?) )",
    );
    expect(calls[0].values).toEqual([30, 5]);
  });

  /**
   * The finish tool's delete. Unscoped on purpose — the table holds one run and
   * every agent writes the same actor — and counted in SQL, so a long run's ids
   * never cross the wire just to be counted.
   */
  it("clears every line and says how many", async () => {
    const { sql, calls } = makeFakeSql(() => [{ cleared: 53 }]);
    await expect(createBetaStore(sql).clearAgentActivity()).resolves.toBe(53);
    const text = flat(calls[0].text);
    expect(text).toContain("DELETE FROM beta_agent_activity RETURNING id");
    expect(text).toContain("SELECT count(*)::int AS cleared FROM cleared");
    expect(text).not.toContain("WHERE");
  });
});
