/**
 * HallPass — the review MODERATION store: the admin write side of reviews.
 *
 * `store.ts` is what a PLAYER can do (write one review, vote, report). This is
 * what an ADMIN can do about the result: work the report queue, hide, delete,
 * purge, dismiss, ban. It is a separate module rather than more methods on
 * `createReviewStore` for one reason worth stating — every function here writes
 * `review_moderation_log`, and keeping that in a file of its own makes the rule
 * checkable by reading one screen: if a statement in this file mutates something
 * and does not also INSERT an audit row, it is a bug.
 *
 * A `createModerationStore(sql)` FACTORY, like `scoreboard/store.ts`,
 * `social/store.ts` and `reviews/store.ts`. The type-only driver import keeps the
 * module free of `server-only`, which is what lets the fake-tagged-template seam
 * in `moderation.test.ts` assert the SQL branch selection without a database.
 *
 * SQL SAFETY, carried from every other store: the `neon()` tagged template
 * parameterises interpolated VALUES; it does NOT reliably splice raw SQL
 * fragments. Nothing below interpolates a fragment — including `ban()`'s optional
 * backlog hide, which branches in JS into two fully-written templates rather than
 * conditionally appending a CTE, exactly as `selectTopRows` branches on sort.
 *
 * ONE STATEMENT PER MUTATION, forced by the driver: `neon()` is SQL-over-HTTP with
 * one stateless request per call, so a transaction cannot span two of them. Here
 * that constraint is a feature rather than a tax — the mutation, the closing of
 * the open reports, and the audit row are folded into a single multi-CTE
 * statement, so there is no interleaving in which a review is hidden but the
 * action was never logged, or logged but never applied.
 *
 * TWO ID SPACES, and getting this backwards is the leak this file exists to
 * prevent:
 *
 *   IDs IN are INTERNAL — `players.id`, i.e. the Google subject id. `ban()`,
 *   `unban()` and `dismissAllFromReporter()` take it because `review_bans` is
 *   keyed on it (see the migration: no FK, because the ban must outlive the
 *   players row).
 *
 *   IDs OUT are PUBLIC — `public_id`, a random UUID. No type returned from this
 *   module has a field that can hold `players.id` or `players.email`, and that is
 *   enforced by the TYPES, not by remembering. The queue is the single most
 *   tempting place in the codebase to `SELECT p.email` "just for the admin", and
 *   the moment it is selected it is one careless spread away from a client
 *   component.
 *
 * `internalIdFromPublicId()` is the deliberate seam between the two spaces: a
 * route takes the public id out of the form, resolves it server-side, and hands
 * the internal id to `ban()`.
 *
 * `actor_email` is a DIFFERENT email and is fine to render: it is a
 * `dashboard_users` address — a colleague's work account, and the entire point of
 * an audit trail is that it names who acted. The prohibition is on `players.email`,
 * which for this audience is a child's school address.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

/**
 * Page sizes, clamped in JS before they are bound.
 *
 * The clamp is not cosmetic: `limit` reaches Postgres as a bound value, and
 * `LIMIT NULL` means NO LIMIT. A caller that forwards an unparsed query string
 * would otherwise turn one bad URL into a full-table read of the log.
 */
const QUEUE_DEFAULT_LIMIT = 50;
const QUEUE_MAX_LIMIT = 200;
const LOG_DEFAULT_LIMIT = 50;
const LOG_MAX_LIMIT = 200;

/** BIGINT and count(*) arrive as strings from the HTTP driver. */
function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIso(value: unknown): string {
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

export type ReviewStatus = "visible" | "hidden" | "deleted";

function toStatus(value: unknown): ReviewStatus {
  return value === "hidden" || value === "deleted" ? value : "visible";
}

/**
 * `publicDisplayName()` semantics, reproduced rather than imported.
 *
 * `players.ts` imports the shared server-only `sql`, so importing from it would
 * drag a live connection into a module whose whole point is being testable
 * without one — the same trade `social/store.ts` makes. Handle, else "@username",
 * else "Player". The Google `name` is NOT a fallback and is never selected here:
 * for a school account it is a child's real name, and an admin screen is still a
 * screen that gets shoulder-surfed and screenshotted.
 */
function displayName(row: {
  handle?: unknown;
  username?: unknown;
}): string {
  const handle = row.handle == null ? null : String(row.handle).trim();
  const username = row.username == null ? null : String(row.username).trim();
  return handle || (username ? `@${username}` : "Player");
}

/** One open report, as shown to a moderator. */
export type QueuedReport = {
  id: number;
  reason: string;
  createdAt: string;
  /**
   * `id` is the reporter's `public_id`, and it is NULL for an orphaned report —
   * `review_reports.reporter_id` is ON DELETE SET NULL so a reporter deleting
   * their account cannot silently empty the queue. Carried so the UI can offer
   * "dismiss everything from this reporter" against a serial false-reporter.
   */
  reporter: { id: string | null; displayName: string };
};

/**
 * One review as a moderator sees it: the text, who wrote it, and where it stands.
 *
 * SHARED BY BOTH READS, which is the point of it existing separately. The queue
 * shows reviews somebody objected to; `recentReviews` shows reviews nobody has
 * yet. They are the same object in the same product with the same verbs
 * available, and splitting them into two unrelated shapes would mean the second
 * screen slowly growing its own idea of what a review is.
 */
export type ReviewEntry = {
  review: {
    id: number;
    slug: string;
    body: string;
    status: ReviewStatus;
    recommended: boolean;
    createdAt: string;
    helpfulCount: number;
    reportCount: number;
  };
  /** Email-free and internal-id-free BY CONSTRUCTION — there are no such fields. */
  author: {
    /** `public_id`, never `players.id`. Feed it to `internalIdFromPublicId()`. */
    id: string;
    username: string | null;
    displayName: string;
    image: string | null;
    /** So the UI does not offer a ban to someone already banned. */
    banned: boolean;
  };
  openReports: number;
};

/** One row of the work list: a reported review, plus who objected and why. */
export type QueueEntry = ReviewEntry & {
  reports: QueuedReport[];
  /** The sort key: newest report first, because a fresh report is a live problem. */
  latestReportAt: string;
};

/** Exactly the actions `review_moderation_log`'s CHECK constraint enumerates. */
export type ModerationAction =
  | "hide"
  | "unhide"
  | "delete"
  | "purge"
  | "dismiss"
  | "ban"
  | "unban"
  | "hide_backlog";

export type ModerationLogEntry = {
  id: number;
  /** A `dashboard_users` address — see the module docblock on the two emails. */
  actorEmail: string;
  action: ModerationAction;
  reviewId: number | null;
  slug: string | null;
  reason: string | null;
  createdAt: string;
  /**
   * The player the action was about, resolved to public identity. NULL when the
   * log row had no `player_id` at all (a bare report dismissal).
   *
   * `id` can be null while `target` is non-null, and that combination is the
   * whole reason `review_bans` has no foreign key: the account was deleted, the
   * ban row deliberately survived it, so there is no `players` row left to resolve
   * — and the same Google subject will match again on re-signup.
   */
  target: { id: string | null; displayName: string } | null;
};

/**
 * The honest outcome of a single-review action.
 *
 * Three fields rather than a boolean because the three cases are genuinely
 * different to a caller: `found: false` is a 404, `changed: false` means it was
 * already in that state (a re-submitted form, or the auto-hide having got there
 * first), and `reportsClosed` is what actually drained the queue.
 */
export type ReviewActionResult = {
  found: boolean;
  changed: boolean;
  reportsClosed: number;
};

export type BanResult = {
  /** Always true for an existing/updated ban; false only if nothing was written. */
  banned: boolean;
  /** Reviews hidden by `hideBacklog`. Zero when it was left off (the default). */
  backlogHidden: number;
};

export type BanOptions = {
  reason?: string | null;
  /** NULL = permanent, per the migration. */
  expiresAt?: Date | null;
  /** See `ban()` — defaults to FALSE, deliberately. */
  hideBacklog?: boolean;
};

export function createModerationStore(sql: Sql) {
  function mapReports(value: unknown): QueuedReport[] {
    // `json_agg` comes back already parsed by the driver's type parsers, but a
    // fake `sql` in a test (and any future `arrayMode`/raw-text setting) can hand
    // back the string form. Accepting both costs three lines and removes a class
    // of "works in prod, throws in the test" divergence.
    const raw =
      typeof value === "string"
        ? (JSON.parse(value) as unknown)
        : (value as unknown);
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => {
      const r = (item ?? {}) as Row;
      return {
        id: toInt(r.id),
        reason: String(r.reason ?? "other"),
        createdAt: toIso(r.created_at),
        reporter: {
          id: r.reporter_public_id == null ? null : String(r.reporter_public_id),
          displayName: displayName({
            handle: r.reporter_handle,
            username: r.reporter_username,
          }),
        },
      };
    });
  }

  /** The columns both reads select, decoded once. */
  function mapReviewEntry(row: Row): ReviewEntry {
    return {
      review: {
        id: toInt(row.id),
        slug: String(row.slug),
        body: String(row.body),
        status: toStatus(row.status),
        recommended: Boolean(row.recommended),
        createdAt: toIso(row.created_at),
        helpfulCount: toInt(row.helpful_count),
        reportCount: toInt(row.report_count),
      },
      author: {
        id: String(row.public_id),
        username: row.username == null ? null : String(row.username),
        displayName: displayName(row),
        image: row.image == null ? null : String(row.image),
        banned: Boolean(row.author_banned),
      },
      openReports: toInt(row.open_count),
    };
  }

  function mapQueueEntry(row: Row): QueueEntry {
    return {
      ...mapReviewEntry(row),
      reports: mapReports(row.reports),
      latestReportAt: toIso(row.newest_report_at),
    };
  }

  return {
    // -----------------------------------------------------------------------
    // Reads
    // -----------------------------------------------------------------------

    /**
     * The work list: every review carrying at least one OPEN report, newest
     * report first.
     *
     * ONE query. The obvious shape — fetch reports, then fetch reviews, then
     * fetch authors — is three round trips over HTTP and an N+1 the moment the
     * queue is non-trivial, so the reports are aggregated into a JSON array by
     * `json_agg` inside a grouped subquery and joined once. The subquery groups
     * BEFORE the join so `count(*)` counts reports rather than the join product,
     * which is the classic way this query goes quietly wrong.
     *
     * The status of the review is NOT filtered. An auto-hidden review (three
     * distinct reporters, see `reportReview`) still belongs here — its reports are
     * open precisely because auto-hide defers to a human — and so does a
     * `deleted` tombstone, which exists so a report still points at real text
     * after the author removed it.
     *
     * *** NO EMAIL IS SELECTED. *** Not the author's, not the reporter's. This is
     * the query where "the admin might want it" is most persuasive and most
     * wrong: it is a child's school address, it is not needed to judge a review,
     * and a column that is never selected cannot be leaked by a later refactor
     * that spreads the row into a client component.
     */
    async queue(opts: { limit?: number } = {}): Promise<QueueEntry[]> {
      const limit = clamp(opts.limit, QUEUE_DEFAULT_LIMIT, QUEUE_MAX_LIMIT);
      const rows = await sql`
        SELECT r.id,
               r.slug,
               r.body,
               r.status,
               r.recommended,
               r.created_at,
               r.helpful_count,
               r.report_count,
               p.public_id,
               p.username,
               p.handle,
               p.image,
               (b.player_id IS NOT NULL) AS author_banned,
               q.open_count,
               q.newest_report_at,
               q.reports
        FROM (
          SELECT rp.review_id,
                 count(*)::int      AS open_count,
                 max(rp.created_at) AS newest_report_at,
                 json_agg(
                   json_build_object(
                     'id', rp.id,
                     'reason', rp.reason,
                     'created_at', rp.created_at,
                     'reporter_public_id', rep.public_id,
                     'reporter_handle', rep.handle,
                     'reporter_username', rep.username
                   )
                   ORDER BY rp.created_at DESC, rp.id DESC
                 ) AS reports
          FROM review_reports rp
          LEFT JOIN players rep ON rep.id = rp.reporter_id
          WHERE rp.status = 'open'
          GROUP BY rp.review_id
        ) q
        JOIN game_reviews r ON r.id = q.review_id
        JOIN players p ON p.id = r.player_id
        LEFT JOIN review_bans b
               ON b.player_id = r.player_id
              AND (b.expires_at IS NULL OR b.expires_at > now())
        ORDER BY q.newest_report_at DESC, r.id DESC
        LIMIT ${limit}
      `;
      return rows.map(mapQueueEntry);
    },

    /**
     * The audit trail, newest first.
     *
     * Ordered `(created_at DESC, id DESC)` — the tiebreak is load-bearing rather
     * than defensive: `ban()` with `hideBacklog` writes its `ban` and
     * `hide_backlog` rows in ONE statement, so both carry the identical `now()`
     * and only `id` can put them in causal order.
     *
     * The raw `player_id` is deliberately not returned. It is the Google subject
     * id; an admin page is still HTML that reaches a browser, and there is no
     * reason for a stable third-party identifier for a minor to be in it. The
     * LEFT JOIN resolves it to `public_id` + display name, and the unresolved case
     * is meaningful in itself (see `ModerationLogEntry.target`).
     */
    async recentActions(limit?: number): Promise<ModerationLogEntry[]> {
      const capped = clamp(limit, LOG_DEFAULT_LIMIT, LOG_MAX_LIMIT);
      const rows = await sql`
        SELECT l.id,
               l.actor_email,
               l.action,
               l.review_id,
               l.slug,
               l.reason,
               l.created_at,
               (l.player_id IS NOT NULL) AS has_target,
               p.public_id,
               p.handle,
               p.username
        FROM review_moderation_log l
        LEFT JOIN players p ON p.id = l.player_id
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT ${capped}
      `;
      return rows.map((row) => ({
        id: toInt(row.id),
        actorEmail: String(row.actor_email),
        action: String(row.action) as ModerationAction,
        reviewId: row.review_id == null ? null : toInt(row.review_id),
        slug: row.slug == null ? null : String(row.slug),
        reason: row.reason == null ? null : String(row.reason),
        createdAt: toIso(row.created_at),
        target: !row.has_target
          ? null
          : {
              id: row.public_id == null ? null : String(row.public_id),
              // The account is gone but the log row (and any ban) survived it.
              displayName:
                row.public_id == null ? "Deleted player" : displayName(row),
            },
      }));
    },

    /**
     * Open reports outstanding — the nav badge.
     *
     * Counts REPORTS, not reviews with reports: the badge is a size-of-inbox
     * signal and one review reported nine times is nine things somebody flagged.
     * Served entirely by `review_reports_open_idx`, the partial index on
     * `status = 'open'`, so it stays cheap as the resolved rows accumulate.
     */
    async openReportCount(): Promise<number> {
      const rows = await sql`
        SELECT count(*)::int AS n FROM review_reports WHERE status = 'open'
      `;
      return toInt(rows[0]?.n);
    },

    /**
     * Resolve a `public_id` UUID to the internal player id — the ONE crossing
     * between the two id spaces, kept explicit so every caller of `ban()` has to
     * pass through it.
     */
    async internalIdFromPublicId(publicId: string): Promise<string | null> {
      // Guarded in JS: Postgres raises 22P02 on a malformed uuid cast, which turns
      // a bad request into a 500 instead of a clean null. Same guard as
      // `social/store.ts`.
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          publicId,
        )
      ) {
        return null;
      }
      const rows = await sql`
        SELECT id FROM players WHERE public_id = ${publicId}::uuid
      `;
      return rows.length > 0 ? String(rows[0].id) : null;
    },

    // -----------------------------------------------------------------------
    // Writes
    //
    // Every one of these is a single multi-CTE statement ending in a scalar
    // SELECT, and every one INSERTs into `review_moderation_log` from the same
    // snapshot as the mutation. The `before` CTE is a plain SELECT, so it sees the
    // PRE-update row — that is how `changed` can be reported honestly and how the
    // slug/player_id reach the log row even when the mutation itself is a DELETE.
    //
    // A note on the parameter casts (`${x}::text`): inside `INSERT ... SELECT`,
    // Postgres does not infer a parameter's type from the target column the way it
    // does for `INSERT ... VALUES`, so an un-cast NULL reason fails outright with
    // "could not determine data type of parameter". Loud at runtime rather than
    // silent, but still a 500 nobody needs.
    // -----------------------------------------------------------------------

    /**
     * Take a review down. Reversible — this is the default moderator verb.
     *
     * Only a `visible` review moves. Already-`hidden` is the COMMON case, not an
     * error: auto-hide got there first and the moderator is confirming it, so the
     * status is already correct and only the reports need closing. A `deleted`
     * tombstone must never be rewritten to `hidden`, or the record that the AUTHOR
     * removed it is lost and a repeat offender's history is laundered.
     *
     * The audit row is written whenever the review exists, including when the
     * status did not move: the moderator did act — they adjudicated three reports
     * — and an action that leaves no trace is exactly what this table is for.
     */
    async hide(
      reviewId: number,
      actorEmail: string,
      reason?: string | null,
    ): Promise<ReviewActionResult> {
      const rows = await sql`
        WITH before AS (
          SELECT id, slug, player_id FROM game_reviews WHERE id = ${reviewId}
        ),
        upd AS (
          UPDATE game_reviews
          SET status = 'hidden', status_changed_at = now()
          WHERE id = ${reviewId} AND status = 'visible'
          RETURNING id
        ),
        closed AS (
          UPDATE review_reports
          SET status = 'actioned', resolved_at = now(), resolved_by = ${actorEmail}
          WHERE review_id IN (SELECT id FROM before) AND status = 'open'
          RETURNING id
        ),
        logged AS (
          INSERT INTO review_moderation_log (actor_email, action, review_id, player_id, slug, reason)
          SELECT ${actorEmail}::text, 'hide', b.id, b.player_id, b.slug, ${reason ?? null}::text
          FROM before b
          RETURNING id
        )
        SELECT (SELECT count(*) FROM before)::int AS found,
               (SELECT count(*) FROM upd)::int    AS changed,
               (SELECT count(*) FROM closed)::int AS reports_closed
      `;
      const row = rows[0] ?? {};
      return {
        found: toInt(row.found) > 0,
        changed: toInt(row.changed) > 0,
        reportsClosed: toInt(row.reports_closed),
      };
    },

    /**
     * Put a review back. Only from `hidden` — un-deleting an author's tombstone
     * would republish text they chose to remove, which is not a moderator's call.
     *
     * `report_count` is RESET, and this is the one non-obvious write in the file.
     * That column is not a statistic; it is the input to the auto-hide threshold
     * in `reportReview`. Leaving it at 3+ after a human decided the review is fine
     * means the very next single report re-hides it instantly — handing one
     * griefer a standing veto over a moderator's explicit decision. The report
     * ROWS survive in `review_reports` as the historical record; what is cleared
     * is a counter whose only job is a threshold that has already been
     * adjudicated.
     */
    async unhide(
      reviewId: number,
      actorEmail: string,
    ): Promise<ReviewActionResult> {
      const rows = await sql`
        WITH before AS (
          SELECT id, slug, player_id FROM game_reviews WHERE id = ${reviewId}
        ),
        upd AS (
          UPDATE game_reviews
          SET status = 'visible', status_changed_at = now(), report_count = 0
          WHERE id = ${reviewId} AND status = 'hidden'
          RETURNING id
        ),
        closed AS (
          UPDATE review_reports
          SET status = 'actioned', resolved_at = now(), resolved_by = ${actorEmail}
          WHERE review_id IN (SELECT id FROM before) AND status = 'open'
          RETURNING id
        ),
        logged AS (
          INSERT INTO review_moderation_log (actor_email, action, review_id, player_id, slug)
          SELECT ${actorEmail}::text, 'unhide', b.id, b.player_id, b.slug
          FROM before b
          RETURNING id
        )
        SELECT (SELECT count(*) FROM before)::int AS found,
               (SELECT count(*) FROM upd)::int    AS changed,
               (SELECT count(*) FROM closed)::int AS reports_closed
      `;
      const row = rows[0] ?? {};
      return {
        found: toInt(row.found) > 0,
        changed: toInt(row.changed) > 0,
        reportsClosed: toInt(row.reports_closed),
      };
    },

    /**
     * Tombstone a review: `status = 'deleted'`, row kept.
     *
     * Stronger than `hide` (there is no un-delete here) but still not destructive,
     * which is the right default for "this was nasty" as opposed to "this must not
     * exist". Keeping the row keeps the evidence: the next moderator can see what
     * the reports were about, and the author cannot launder a pattern of offences
     * by having them erased one at a time. Logged as `delete`, the verb the
     * table's CHECK constraint enumerates.
     */
    async softDelete(
      reviewId: number,
      actorEmail: string,
      reason?: string | null,
    ): Promise<ReviewActionResult> {
      const rows = await sql`
        WITH before AS (
          SELECT id, slug, player_id FROM game_reviews WHERE id = ${reviewId}
        ),
        upd AS (
          UPDATE game_reviews
          SET status = 'deleted', status_changed_at = now()
          WHERE id = ${reviewId} AND status <> 'deleted'
          RETURNING id
        ),
        closed AS (
          UPDATE review_reports
          SET status = 'actioned', resolved_at = now(), resolved_by = ${actorEmail}
          WHERE review_id IN (SELECT id FROM before) AND status = 'open'
          RETURNING id
        ),
        logged AS (
          INSERT INTO review_moderation_log (actor_email, action, review_id, player_id, slug, reason)
          SELECT ${actorEmail}::text, 'delete', b.id, b.player_id, b.slug, ${reason ?? null}::text
          FROM before b
          RETURNING id
        )
        SELECT (SELECT count(*) FROM before)::int AS found,
               (SELECT count(*) FROM upd)::int    AS changed,
               (SELECT count(*) FROM closed)::int AS reports_closed
      `;
      const row = rows[0] ?? {};
      return {
        found: toInt(row.found) > 0,
        changed: toInt(row.changed) > 0,
        reportsClosed: toInt(row.reports_closed),
      };
    },

    /**
     * A REAL delete — the row leaves the database.
     *
     * Reserved for content that must not persist anywhere, which on a site for
     * children means one thing above all: a phone number, an address, or another
     * pupil's real name. A tombstone keeps the body, so for that case a tombstone
     * is the wrong tool; the audit row records that a purge happened, by whom, on
     * whose review, and why — without keeping the text itself.
     *
     * The open reports are closed by BEING DELETED: `review_reports.review_id` is
     * ON DELETE CASCADE, so they go with the row (as do the helpful votes). This
     * statement deliberately does NOT also UPDATE them to 'actioned' — that would
     * be writing to rows the same statement is about to remove. `reportsClosed` is
     * therefore counted from the pre-delete snapshot, which is the honest number.
     *
     * The log row is inserted in the same statement as the DELETE and survives it:
     * `review_moderation_log.review_id` is a bare BIGINT with no foreign key,
     * precisely so an audit trail cannot be erased by deleting what it refers to.
     */
    async purge(
      reviewId: number,
      actorEmail: string,
      reason?: string | null,
    ): Promise<ReviewActionResult> {
      const rows = await sql`
        WITH before AS (
          SELECT id, slug, player_id FROM game_reviews WHERE id = ${reviewId}
        ),
        open_reports AS (
          SELECT count(*)::int AS n FROM review_reports
          WHERE review_id IN (SELECT id FROM before) AND status = 'open'
        ),
        logged AS (
          INSERT INTO review_moderation_log (actor_email, action, review_id, player_id, slug, reason)
          SELECT ${actorEmail}::text, 'purge', b.id, b.player_id, b.slug, ${reason ?? null}::text
          FROM before b
          RETURNING id
        ),
        del AS (
          DELETE FROM game_reviews WHERE id IN (SELECT id FROM before)
          RETURNING id
        )
        SELECT (SELECT count(*) FROM before)::int AS found,
               (SELECT count(*) FROM del)::int    AS changed,
               (SELECT n FROM open_reports)::int  AS reports_closed
      `;
      const row = rows[0] ?? {};
      return {
        found: toInt(row.found) > 0,
        changed: toInt(row.changed) > 0,
        reportsClosed: toInt(row.reports_closed),
      };
    },

    /**
     * "Looked at it, nothing wrong" — resolve one report without touching the
     * review.
     *
     * `dismissed` rather than `actioned` is the distinction the schema draws and
     * it is worth keeping honest: `actioned` means the review was changed,
     * `dismissed` means the REPORT was wrong. It is also the only way to tell,
     * later, that a particular reporter is the problem.
     *
     * `report_count` is untouched. A dismissed report still happened, and
     * decrementing would let a bad-faith reporter's withdrawn signal reset the
     * auto-hide threshold for the next one.
     */
    async dismissReport(reportId: number, actorEmail: string): Promise<boolean> {
      const rows = await sql`
        WITH upd AS (
          UPDATE review_reports
          SET status = 'dismissed', resolved_at = now(), resolved_by = ${actorEmail}
          WHERE id = ${reportId} AND status = 'open'
          RETURNING id, review_id
        ),
        logged AS (
          INSERT INTO review_moderation_log (actor_email, action, review_id, player_id, slug)
          SELECT ${actorEmail}::text, 'dismiss', r.id, r.player_id, r.slug
          FROM upd JOIN game_reviews r ON r.id = upd.review_id
          RETURNING id
        )
        SELECT (SELECT count(*) FROM upd)::int AS dismissed
      `;
      return toInt(rows[0]?.dismissed) > 0;
    },

    /**
     * Dismiss every open report filed by one person — the answer to a pupil who
     * has discovered the report button and flagged half the site.
     *
     * ONE log row, not one per report: a mass dismissal is a single decision about
     * a single reporter, and forty rows would bury the rest of the trail. That row
     * is identifiable in the log by `player_id` set with `review_id` NULL, and the
     * count goes in `reason` because there is no column for it and inventing one
     * would mean a migration this file does not own.
     *
     * `reporterId` is an INTERNAL `players.id` — see the module docblock.
     */
    async dismissAllFromReporter(
      reporterId: string,
      actorEmail: string,
    ): Promise<number> {
      const rows = await sql`
        WITH upd AS (
          UPDATE review_reports
          SET status = 'dismissed', resolved_at = now(), resolved_by = ${actorEmail}
          WHERE reporter_id = ${reporterId} AND status = 'open'
          RETURNING id
        ),
        logged AS (
          INSERT INTO review_moderation_log (actor_email, action, player_id, reason)
          SELECT ${actorEmail}::text, 'dismiss', ${reporterId}::text,
                 'bulk dismissal of ' || (SELECT count(*) FROM upd) || ' open report(s)'
          WHERE EXISTS (SELECT 1 FROM upd)
          RETURNING id
        )
        SELECT (SELECT count(*) FROM upd)::int AS dismissed
      `;
      return toInt(rows[0]?.dismissed);
    },

    /**
     * Ban a player from writing reviews. `upsertReview` checks `review_bans` inside
     * its own write statement, so the ban takes effect atomically on the next
     * attempt with no TOCTOU window.
     *
     * `ON CONFLICT (player_id) DO UPDATE` because re-banning must be an UPDATE:
     * the common real sequence is a 7-day ban followed by a permanent one, and a
     * DO NOTHING would silently keep the shorter expiry — the single most likely
     * way for this feature to fail quietly.
     *
     * `hideBacklog` DEFAULTS TO FALSE, and that default is the actual policy
     * decision here. A ban almost always follows ONE bad review. Mass-hiding a
     * term's worth of a child's harmless reviews is disproportionate to that, and
     * it destroys the context the NEXT moderator needs to judge whether the ban
     * was fair or should be lifted. Least destructive default; the admin who has
     * actually read the case is the one who opts in.
     *
     * When it IS on, the backlog hide does NOT close those reviews' open reports —
     * deliberately, and unlike `hide()`. A bulk hide is taken without reading each
     * review; marking their reports adjudicated would claim a human judged
     * something nobody read. The reviews stay in the queue, now visibly hidden,
     * for a human to reach.
     *
     * Two fully-written templates rather than one with a conditional CTE: the
     * driver parameterises values, not fragments (see the module docblock).
     */
    async ban(
      playerId: string,
      actorEmail: string,
      opts: BanOptions = {},
    ): Promise<BanResult> {
      const reason = opts.reason ?? null;
      // Bound as an ISO string with an explicit cast rather than relying on the
      // driver's Date encoding, so a NULL (= permanent) still has a known type.
      const expiresAt = opts.expiresAt ? opts.expiresAt.toISOString() : null;

      if (!opts.hideBacklog) {
        const rows = await sql`
          WITH ins AS (
            INSERT INTO review_bans (player_id, reason, expires_at, created_by)
            VALUES (${playerId}, ${reason}::text, ${expiresAt}::timestamptz, ${actorEmail})
            ON CONFLICT (player_id) DO UPDATE
              SET reason     = EXCLUDED.reason,
                  expires_at = EXCLUDED.expires_at,
                  created_by = EXCLUDED.created_by,
                  created_at = now()
            RETURNING player_id
          ),
          logged AS (
            INSERT INTO review_moderation_log (actor_email, action, player_id, reason)
            SELECT ${actorEmail}::text, 'ban', ins.player_id, ${reason}::text
            FROM ins
            RETURNING id
          )
          SELECT (SELECT count(*) FROM ins)::int AS banned
        `;
        return { banned: toInt(rows[0]?.banned) > 0, backlogHidden: 0 };
      }

      const rows = await sql`
        WITH ins AS (
          INSERT INTO review_bans (player_id, reason, expires_at, created_by)
          VALUES (${playerId}, ${reason}::text, ${expiresAt}::timestamptz, ${actorEmail})
          ON CONFLICT (player_id) DO UPDATE
            SET reason     = EXCLUDED.reason,
                expires_at = EXCLUDED.expires_at,
                created_by = EXCLUDED.created_by,
                created_at = now()
          RETURNING player_id
        ),
        hid AS (
          UPDATE game_reviews
          SET status = 'hidden', status_changed_at = now()
          WHERE player_id = ${playerId} AND status = 'visible'
          RETURNING id
        ),
        logged AS (
          INSERT INTO review_moderation_log (actor_email, action, player_id, reason)
          SELECT ${actorEmail}::text, 'ban', ins.player_id, ${reason}::text
          FROM ins
          RETURNING id
        ),
        logged_backlog AS (
          INSERT INTO review_moderation_log (actor_email, action, player_id, reason)
          SELECT ${actorEmail}::text, 'hide_backlog', ${playerId}::text,
                 'hid ' || (SELECT count(*) FROM hid) || ' visible review(s) on ban'
          WHERE EXISTS (SELECT 1 FROM hid)
          RETURNING id
        )
        SELECT (SELECT count(*) FROM ins)::int AS banned,
               (SELECT count(*) FROM hid)::int AS hidden
      `;
      const row = rows[0] ?? {};
      return {
        banned: toInt(row.banned) > 0,
        backlogHidden: toInt(row.hidden),
      };
    },

    /**
     * Lift a ban by deleting the row — the row IS the ban, so an "expired" flag
     * would just be a second way to say the same thing and a second thing to get
     * wrong in `upsertReview`'s gate.
     *
     * Reviews hidden by `hideBacklog` are NOT restored. Unbanning says "you may
     * write again", not "everything you wrote was fine", and the two are different
     * enough that conflating them would silently republish content a moderator
     * hid. Restoring one is `unhide()`, one at a time, on purpose.
     */
    async unban(playerId: string, actorEmail: string): Promise<boolean> {
      const rows = await sql`
        WITH del AS (
          DELETE FROM review_bans WHERE player_id = ${playerId}
          RETURNING player_id
        ),
        logged AS (
          INSERT INTO review_moderation_log (actor_email, action, player_id)
          SELECT ${actorEmail}::text, 'unban', del.player_id
          FROM del
          RETURNING id
        )
        SELECT (SELECT count(*) FROM del)::int AS removed
      `;
      return toInt(rows[0]?.removed) > 0;
    },
  };
}

export type ModerationStore = ReturnType<typeof createModerationStore>;
