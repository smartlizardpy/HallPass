/**
 * HallPass — the review store.
 *
 * A `createReviewStore(sql)` factory, like `scoreboard/store.ts` and
 * `social/store.ts`: the write path is a single multi-CTE statement with five
 * gates, and the fake-tagged-template seam is the only way to test those branches
 * without a database.
 *
 * SQL SAFETY: the `neon()` tagged template parameterises VALUES only and does not
 * reliably splice fragments. Nothing here interpolates a fragment — including the
 * sort, which branches in JS into two fully-written query templates rather than
 * building an `ORDER BY`, exactly as `selectTopRows` does.
 *
 * ONE STATEMENT PER MUTATION, forced by the driver: `neon()` is SQL-over-HTTP with
 * one stateless request per call, so a transaction cannot span two of them and a
 * check-then-write split has a real window in between.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  REVIEW_DUP_WINDOW_SECONDS,
  REVIEW_IP_RATE_LIMIT,
  REVIEW_MIN_ACCOUNT_AGE_MINUTES,
  REVIEW_PLAYER_RATE_LIMIT,
  REVIEWS_PAGE_SIZE,
  REVIEW_AUTO_HIDE_REPORTS,
} from "./config";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIso(value: unknown): string {
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/** A review as sent to the browser. Email-free and internal-id-free by construction. */
export type Review = {
  id: number;
  recommended: boolean;
  body: string;
  helpfulCount: number;
  createdAt: string;
  edited: boolean;
  author: {
    /** `public_id`, never `players.id` (the Google subject). */
    id: string;
    username: string | null;
    displayName: string;
    image: string | null;
    /**
     * Stable, SALTED discriminator so two players with the same display handle
     * are distinguishable. Handles are not unique, so without it, impersonating
     * someone by copying their handle is a two-second attack. Salted rather than
     * derived from the raw subject id, or it would be a durable cross-site
     * identifier for a minor.
     */
    tag: string;
  };
};

export type ReviewSort = "recent" | "helpful";

/** Why a submission was refused, decoded from the single write statement. */
export type SubmitOutcome =
  | "ok"
  | "duplicate"
  | "banned"
  | "too-new"
  | "rate-limited";

/**
 * What a report actually did, decoded from the single write statement.
 *
 * Only `filed` puts a row in the moderation queue. The other three are the ways
 * a report can legitimately do nothing, and they are spelled out rather than
 * collapsed because the caller owes the reporter a different answer for each:
 *
 *   `duplicate` — this person had already reported this review. The dedup index
 *                 caps them at one, which is the point.
 *   `self`      — the reporter IS the author. Suppressed as noise; see below.
 *   `missing`   — no such review. Purged, or an id that never existed.
 */
export type ReportOutcome = "filed" | "duplicate" | "self" | "missing";

export function createReviewStore(sql: Sql) {
  function mapReview(row: Row): Review {
    const handle = row.handle == null ? null : String(row.handle).trim();
    const username = row.username == null ? null : String(row.username);
    return {
      id: toInt(row.id),
      recommended: Boolean(row.recommended),
      body: String(row.body),
      helpfulCount: toInt(row.helpful_count),
      createdAt: toIso(row.created_at),
      // `updated_at` diverging from `created_at` by more than a second means the
      // author edited it; the second of slack absorbs clock/rounding noise.
      edited:
        Math.abs(
          new Date(String(row.updated_at)).getTime() -
            new Date(String(row.created_at)).getTime(),
        ) > 1000,
      author: {
        id: String(row.public_id),
        username,
        // Never the Google `name` — that is the player's real name for most
        // accounts. Handle, else "@username", else "Player".
        displayName: handle || (username ? `@${username}` : "Player"),
        image: row.image == null ? null : String(row.image),
        tag: String(row.author_tag ?? "").slice(0, 4),
      },
    };
  }

  return {
    /**
     * A page of visible reviews.
     *
     * KEYSET PAGINATION, not OFFSET. With newest-first ordering and active
     * posting, `OFFSET` skips and duplicates rows as new reviews arrive, and it
     * is O(offset). Two hand-written templates branch in JS on the sort, so no
     * fragment is ever spliced.
     *
     * `count(*) OVER ()` is evaluated before `LIMIT`, so one round trip returns
     * both the page and the true total — which also feeds the section header
     * without a second query.
     */
    async listReviews(
      slug: string,
      opts: { sort: ReviewSort; before: number | null; salt: string },
    ): Promise<{ reviews: Review[]; total: number }> {
      const limit = REVIEWS_PAGE_SIZE;
      const { sort, before, salt } = opts;

      const rows =
        sort === "helpful"
          ? await sql`
              SELECT r.id, r.recommended, r.body, r.helpful_count, r.created_at, r.updated_at,
                     p.public_id, p.username, p.handle, p.image,
                     encode(sha256((p.id || ${salt})::bytea), 'hex') AS author_tag,
                     count(*) OVER () AS total
              FROM game_reviews r
              JOIN players p ON p.id = r.player_id
              WHERE r.slug = ${slug} AND r.status = 'visible'
              ORDER BY r.helpful_count DESC, r.id DESC
              LIMIT ${limit}
            `
          : before === null
            ? await sql`
                SELECT r.id, r.recommended, r.body, r.helpful_count, r.created_at, r.updated_at,
                       p.public_id, p.username, p.handle, p.image,
                       encode(sha256((p.id || ${salt})::bytea), 'hex') AS author_tag,
                       count(*) OVER () AS total
                FROM game_reviews r
                JOIN players p ON p.id = r.player_id
                WHERE r.slug = ${slug} AND r.status = 'visible'
                ORDER BY r.id DESC
                LIMIT ${limit}
              `
            : await sql`
                SELECT r.id, r.recommended, r.body, r.helpful_count, r.created_at, r.updated_at,
                       p.public_id, p.username, p.handle, p.image,
                       encode(sha256((p.id || ${salt})::bytea), 'hex') AS author_tag,
                       count(*) OVER () AS total
                FROM game_reviews r
                JOIN players p ON p.id = r.player_id
                WHERE r.slug = ${slug} AND r.status = 'visible' AND r.id < ${before}
                ORDER BY r.id DESC
                LIMIT ${limit}
              `;

      return {
        reviews: rows.map(mapReview),
        total: rows.length > 0 ? toInt(rows[0].total) : 0,
      };
    },

    /** Recommend/not counts for the header summary. */
    async summary(slug: string): Promise<{ recommended: number; total: number }> {
      const rows = await sql`
        SELECT count(*) FILTER (WHERE recommended)::int AS recommended,
               count(*)::int                            AS total
        FROM game_reviews
        WHERE slug = ${slug} AND status = 'visible'
      `;
      const row = rows[0] ?? {};
      return { recommended: toInt(row.recommended), total: toInt(row.total) };
    },

    /**
     * The plain-text body of a single VISIBLE review, for on-demand translation.
     *
     * Scoped to `status = 'visible'` on purpose: a hidden or deleted review is not
     * shown, so there is nothing on screen to translate, and this closes the only
     * way the translate route could otherwise surface the text of a review a
     * moderator (or its author) had taken down.
     */
    async visibleReviewBody(id: number): Promise<string | null> {
      const rows = await sql`
        SELECT body FROM game_reviews
        WHERE id = ${id} AND status = 'visible'
      `;
      return rows.length > 0 ? String(rows[0].body) : null;
    },

    /**
     * Which game a review belongs to, whatever its status.
     *
     * For the admin notification a report raises: the alert has to name the
     * GAME so it is triageable at a glance, and a report carries only the review
     * id. Deliberately not filtered on `status` — the reviews most worth
     * reporting are exactly the ones already hidden or flagged, and an alert
     * that went unnamed for those would be worst where it matters most.
     */
    async slugForReview(id: number): Promise<string | null> {
      const rows = await sql`
        SELECT slug FROM game_reviews WHERE id = ${id}
      `;
      return rows.length > 0 ? String(rows[0].slug) : null;
    },

    /** The caller's own review for a game, if any — so the form can prefill. */
    async ownReview(slug: string, playerId: string): Promise<Review | null> {
      const rows = await sql`
        SELECT r.id, r.recommended, r.body, r.helpful_count, r.created_at, r.updated_at,
               p.public_id, p.username, p.handle, p.image, '' AS author_tag
        FROM game_reviews r
        JOIN players p ON p.id = r.player_id
        WHERE r.slug = ${slug} AND r.player_id = ${playerId} AND r.status <> 'deleted'
      `;
      return rows.length > 0 ? mapReview(rows[0]) : null;
    },

    /** Which of `reviewIds` the caller has already marked helpful. */
    async myHelpfulVotes(playerId: string, reviewIds: number[]): Promise<number[]> {
      if (reviewIds.length === 0) return [];
      const rows = await sql`
        SELECT review_id FROM review_helpful
        WHERE player_id = ${playerId} AND review_id = ANY(${reviewIds}::bigint[])
      `;
      return rows.map((row) => toInt(row.review_id));
    },

    /**
     * Create or replace the caller's review for a game — ONE statement, five gates.
     *
     *   banned   — checked inside the statement, so enforcement is atomic with the
     *              write and there is no TOCTOU window
     *   too_new  — minimum account age. Defeats the "throwaway Google account ->
     *              post -> repeat" loop by putting a fixed cost on every cycle,
     *              which is the only real lever against ban evasion by new account
     *   recent   — per-player rate limit
     *   recent_ip— loose per-IP backstop (see config: a school is one NAT'd IP)
     *   dup      — same body from the same player recently; this IS the
     *              idempotency mechanism, so a double-click or a flaky-network
     *              retry is a no-op rather than a second write
     *
     * `ON CONFLICT (slug, player_id) DO UPDATE` is what makes this an upsert: a
     * player editing their review rewrites it in place rather than adding a
     * second one, which is the whole point of the one-per-player model.
     *
     * The outer SELECT is deliberately NOT `FROM ins`, so it always returns
     * exactly one row and the caller can tell WHICH gate refused. `appendScore`
     * returns zero rows and cannot, which makes its failures indistinguishable.
     */
    async upsertReview(input: {
      slug: string;
      playerId: string;
      recommended: boolean;
      body: string;
      bodyHash: string;
      ipHash: string | null;
      status: "visible" | "hidden";
    }): Promise<SubmitOutcome> {
      const rows = await sql`
        WITH banned AS (
          SELECT count(*) AS n FROM review_bans
          WHERE player_id = ${input.playerId}
            AND (expires_at IS NULL OR expires_at > now())
        ),
        too_new AS (
          SELECT count(*) AS n FROM players
          WHERE id = ${input.playerId}
            AND created_at > now() - make_interval(0,0,0,0,0,${REVIEW_MIN_ACCOUNT_AGE_MINUTES})
        ),
        recent AS (
          SELECT count(*) AS n FROM game_reviews
          WHERE player_id = ${input.playerId}
            AND updated_at >= now() - make_interval(0,0,0,0,0,0,${REVIEW_PLAYER_RATE_LIMIT.windowSeconds})
        ),
        recent_ip AS (
          SELECT count(*) AS n FROM game_reviews
          WHERE ip_hash = ${input.ipHash}
            AND updated_at >= now() - make_interval(0,0,0,0,0,0,${REVIEW_IP_RATE_LIMIT.windowSeconds})
        ),
        dup AS (
          SELECT id FROM game_reviews
          WHERE player_id = ${input.playerId} AND body_hash = ${input.bodyHash}
            AND updated_at >= now() - make_interval(0,0,0,0,0,0,${REVIEW_DUP_WINDOW_SECONDS})
          LIMIT 1
        ),
        ins AS (
          INSERT INTO game_reviews (slug, player_id, recommended, body, body_hash, ip_hash, status)
          SELECT ${input.slug}, ${input.playerId}, ${input.recommended}, ${input.body},
                 ${input.bodyHash}, ${input.ipHash}, ${input.status}
          WHERE (SELECT n FROM banned)  = 0
            AND (SELECT n FROM too_new) = 0
            AND (SELECT n FROM recent)     < ${REVIEW_PLAYER_RATE_LIMIT.maxPerWindow}
            AND (SELECT n FROM recent_ip)  < ${REVIEW_IP_RATE_LIMIT.maxPerWindow}
            AND NOT EXISTS (SELECT 1 FROM dup)
          ON CONFLICT (slug, player_id) DO UPDATE
            SET recommended = EXCLUDED.recommended,
                body        = EXCLUDED.body,
                body_hash   = EXCLUDED.body_hash,
                status      = EXCLUDED.status,
                updated_at  = now()
          RETURNING id
        )
        SELECT (SELECT count(*) FROM ins)::int      AS inserted,
               (SELECT count(*) FROM dup)::int      AS duplicate,
               (SELECT n FROM banned)::int          AS banned,
               (SELECT n FROM too_new)::int         AS too_new,
               (SELECT n FROM recent)::int          AS recent,
               (SELECT n FROM recent_ip)::int       AS recent_ip
      `;
      const row = rows[0] ?? {};
      if (toInt(row.inserted) > 0) return "ok";
      if (toInt(row.banned) > 0) return "banned";
      if (toInt(row.too_new) > 0) return "too-new";
      if (toInt(row.duplicate) > 0) return "duplicate";
      return "rate-limited";
    },

    /** Author self-delete. A tombstone, not a hard delete — see the migration. */
    async softDeleteOwnReview(slug: string, playerId: string): Promise<boolean> {
      const rows = await sql`
        UPDATE game_reviews
        SET status = 'deleted', status_changed_at = now()
        WHERE slug = ${slug} AND player_id = ${playerId} AND status <> 'deleted'
        RETURNING id
      `;
      return rows.length > 0;
    },

    /**
     * Toggle a helpful vote and keep the denormalised counter in step, in one
     * statement so the two can never drift.
     *
     * The PRIMARY KEY on `(review_id, player_id)` is what makes this idempotent —
     * a double-click cannot inflate the count.
     */
    async toggleHelpful(
      reviewId: number,
      playerId: string,
    ): Promise<{ helpful: boolean; count: number }> {
      const rows = await sql`
        WITH del AS (
          DELETE FROM review_helpful
          WHERE review_id = ${reviewId} AND player_id = ${playerId}
          RETURNING 1
        ),
        ins AS (
          INSERT INTO review_helpful (review_id, player_id)
          SELECT ${reviewId}, ${playerId}
          WHERE NOT EXISTS (SELECT 1 FROM del)
          RETURNING 1
        ),
        upd AS (
          UPDATE game_reviews
          SET helpful_count = GREATEST(
            0,
            helpful_count + (SELECT count(*) FROM ins)::int - (SELECT count(*) FROM del)::int
          )
          WHERE id = ${reviewId}
          RETURNING helpful_count
        )
        SELECT (SELECT count(*) FROM ins)::int   AS added,
               (SELECT helpful_count FROM upd)::int AS count
      `;
      const row = rows[0] ?? {};
      return { helpful: toInt(row.added) > 0, count: toInt(row.count) };
    },

    /**
     * File a report and auto-hide once enough DISTINCT people have reported.
     *
     * One statement, so there is no TOCTOU between counting and hiding. The
     * threshold moves the review to `hidden` (reversible), never `deleted`, and
     * deliberately does NOT resolve the open reports — human review is the point,
     * and auto-hide only shortens the window in which harm is visible.
     *
     * IT RETURNS WHAT HAPPENED, and that is not decoration. Three of the four
     * outcomes file no row at all, so a `void` return made every one of them
     * indistinguishable from success to the route above — which is exactly how a
     * report that never reaches the queue gets answered with "Thanks, reported".
     * The route decides what each outcome is worth telling the reporter; the
     * store's job is only to stop pretending they are all the same.
     *
     * The `target` CTE is what makes `self` observable: the old guard was a
     * `NOT EXISTS` subquery hanging off the insert, which suppressed the row
     * without leaving any trace that it had fired. Same single statement, same
     * self-report rule, one extra column.
     */
    async reportReview(
      reviewId: number,
      reporterId: string,
      reason: string,
      ipHash: string | null,
    ): Promise<ReportOutcome> {
      const rows = await sql`
        WITH target AS (
          -- NOBODY REPORTS THEMSELVES. Not a security control — auto-hide needs
          -- three DISTINCT reporters and the dedup index caps one person at one
          -- report, so a self-report can never hide anything. It is a noise
          -- control, and the moderation queue's entire value is being short
          -- enough that a human actually reads it. An author who wants their own
          -- review gone already has the delete button.
          --
          -- Resolved in the same statement as the insert; a check-then-write
          -- split would need a second round trip the HTTP driver cannot make
          -- transactional.
          SELECT id, (player_id = ${reporterId}) AS own
          FROM game_reviews
          WHERE id = ${reviewId}
        ),
        ins AS (
          INSERT INTO review_reports (review_id, reporter_id, reason, ip_hash)
          -- Selected FROM target, so a report against a review that does not
          -- exist inserts nothing rather than tripping the foreign key.
          SELECT t.id, ${reporterId}::text, ${reason}::text, ${ipHash}::text
          FROM target t
          WHERE NOT t.own
          ON CONFLICT (review_id, reporter_id) DO NOTHING
          RETURNING 1
        ),
        upd AS (
          UPDATE game_reviews
          SET report_count = report_count + (SELECT count(*) FROM ins)::int,
              status = CASE
                WHEN status = 'visible'
                 AND report_count + (SELECT count(*) FROM ins)::int >= ${REVIEW_AUTO_HIDE_REPORTS}
                THEN 'hidden' ELSE status END,
              status_changed_at = CASE
                WHEN status = 'visible'
                 AND report_count + (SELECT count(*) FROM ins)::int >= ${REVIEW_AUTO_HIDE_REPORTS}
                THEN now() ELSE status_changed_at END
          WHERE id = ${reviewId}
          RETURNING id
        )
        SELECT (SELECT count(*) FROM target)::int        AS found,
               COALESCE((SELECT own FROM target), false) AS own,
               (SELECT count(*) FROM ins)::int           AS filed
      `;
      const row = rows[0] ?? {};
      if (toInt(row.found) === 0) return "missing";
      if (row.own === true || row.own === "t") return "self";
      return toInt(row.filed) > 0 ? "filed" : "duplicate";
    },

    /** Whether the caller is currently banned from reviewing. */
    async isBanned(playerId: string): Promise<boolean> {
      const rows = await sql`
        SELECT 1 FROM review_bans
        WHERE player_id = ${playerId} AND (expires_at IS NULL OR expires_at > now())
      `;
      return rows.length > 0;
    },
  };
}

export type ReviewStore = ReturnType<typeof createReviewStore>;
