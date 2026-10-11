/**
 * HallPass — the profile-reports store (factory).
 *
 * Same seam as `invites/store.ts`: the factory takes the tagged-template `sql`
 * so this module stays free of `server-only` and the fake-`sql` tests can
 * assert the shape of every statement; `index.ts` binds the live Neon client.
 *
 * ── ONE STATEMENT PER OPERATION ────────────────────────────────────────────
 * `neon()` is SQL-over-HTTP, so a `BEGIN` here and a `COMMIT` there are not one
 * transaction. `create` therefore resolves the target, counts the reporter's
 * recent reports, applies both limits and inserts, all in one statement against
 * one snapshot. The limits are best-effort under true concurrency (two
 * simultaneous requests can both see a count under the cap), the trade every
 * limiter in this codebase accepts.
 *
 * ── WHO IS WHO ─────────────────────────────────────────────────────────────
 * The target arrives as a `public_id` and is resolved to `players.id` inside the
 * statement, so the internal id (a minor's Google subject) never exists in route
 * code. The queue selects NO email and NO Google `name`: the reported child is
 * shown by `publicDisplayName`'s rule (handle, else `@username`, else "Player").
 * The reporter is not selected at all; admins judge the report, not the child
 * who made it.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  REPORT_DAILY_LIMIT,
  REPORT_HOURLY_LIMIT,
  type ProfileReportReason,
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

/** `publicDisplayName`'s rule, reproduced to keep the factory free of `players.ts`. */
function displayNameFrom(handle: unknown, username: unknown): string {
  const h = handle == null ? null : String(handle).trim();
  const u = username == null ? null : String(username);
  return h || (u ? `@${u}` : "Player");
}

/** What `create` learned. `duplicate` is reported as success by the route. */
export type CreateReportOutcome =
  | { result: "created" }
  | { result: "duplicate" }
  | { result: "self" }
  | { result: "unknown" }
  | { result: "rate-limited" };

/** One open report as the dashboard queue shows it. */
export type QueuedProfileReport = {
  id: number;
  reason: string;
  note: string | null;
  createdAt: string;
  reported: {
    publicId: string;
    username: string | null;
    displayName: string;
  };
  /** Open reports against the same player, this one included. */
  openAgainstPlayer: number;
};

export function createProfileReportStore(sql: Sql) {
  return {
    /**
     * File a report. `reporterId` is the signed-in player's internal id (from
     * the session, never the body); `reportedPublicId` is a validated UUID.
     */
    async create(input: {
      reporterId: string;
      reportedPublicId: string;
      reason: ProfileReportReason;
      note: string | null;
    }): Promise<CreateReportOutcome> {
      const { reporterId, reportedPublicId, reason, note } = input;
      const rows = (await sql`
        WITH target AS (
          SELECT id FROM players WHERE public_id = ${reportedPublicId}::uuid
        ),
        hourly AS (
          SELECT count(*)::int AS n FROM profile_reports
           WHERE reporter_id = ${reporterId}::text
             AND created_at >= now() - make_interval(secs => ${REPORT_HOURLY_LIMIT.windowSeconds})
        ),
        daily AS (
          SELECT count(*)::int AS n FROM profile_reports
           WHERE reporter_id = ${reporterId}::text
             AND created_at >= now() - make_interval(secs => ${REPORT_DAILY_LIMIT.windowSeconds})
        ),
        ins AS (
          INSERT INTO profile_reports (reporter_id, reported_id, reason, note)
          SELECT ${reporterId}::text, t.id, ${reason}::text, ${note}::text
            FROM target t
           WHERE t.id <> ${reporterId}::text
             AND (SELECT n FROM hourly) < ${REPORT_HOURLY_LIMIT.maxPerWindow}
             AND (SELECT n FROM daily) < ${REPORT_DAILY_LIMIT.maxPerWindow}
          ON CONFLICT (reporter_id, reported_id) WHERE status = 'open' DO NOTHING
          RETURNING id
        )
        SELECT (SELECT count(*) FROM target)                          AS found,
               COALESCE((SELECT id FROM target) = ${reporterId}::text, false) AS is_self,
               (SELECT n FROM hourly)                                 AS hourly,
               (SELECT n FROM daily)                                  AS daily,
               (SELECT count(*) FROM ins)                             AS inserted
      `) as Row[];
      const row = rows[0] ?? {};
      if (toInt(row.found) === 0) return { result: "unknown" };
      if (row.is_self === true) return { result: "self" };
      if (toInt(row.inserted) > 0) return { result: "created" };
      if (
        toInt(row.hourly) >= REPORT_HOURLY_LIMIT.maxPerWindow ||
        toInt(row.daily) >= REPORT_DAILY_LIMIT.maxPerWindow
      ) {
        return { result: "rate-limited" };
      }
      return { result: "duplicate" };
    },

    /** Open reports, newest first, each with how many are open against the same player. */
    async queue(input: { limit: number }): Promise<QueuedProfileReport[]> {
      const limit = Math.max(1, Math.min(200, Math.floor(input.limit)));
      const rows = (await sql`
        SELECT r.id, r.reason, r.note, r.created_at,
               p.public_id, p.username, p.handle,
               count(*) OVER (PARTITION BY r.reported_id)::int AS open_against
          FROM profile_reports r
          JOIN players p ON p.id = r.reported_id
         WHERE r.status = 'open'
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ${limit}
      `) as Row[];
      return rows.map((row) => ({
        id: toInt(row.id),
        reason: String(row.reason),
        note: row.note == null ? null : String(row.note),
        createdAt: toIso(row.created_at),
        reported: {
          publicId: String(row.public_id),
          username: row.username == null ? null : String(row.username),
          displayName: displayNameFrom(row.handle, row.username),
        },
        openAgainstPlayer: toInt(row.open_against),
      }));
    },

    /**
     * The account action: in ONE statement (one snapshot, one implicit
     * transaction; `neon()` over HTTP cannot span a BEGIN/COMMIT across calls),
     * for the player this OPEN report is about:
     *   (a) clear `handle` and `username`, so they fall back to the generated
     *       public name (`display-name.ts`) and `/u/<old-username>` stops
     *       resolving;
     *   (b) set `use_google_photo = false`;
     *   (c) mark EVERY open report against that player `actioned`, with the
     *       resolution time and the acting admin.
     * The old username is also tombstoned in `username_history` with a NULL owner
     * (`claimUsername` lets an owner re-claim their OWN tombstoned name, but not a
     * NULL-owner one), so a moderated name cannot be taken straight back, by the
     * child or anyone else, inside `USERNAME_TOMBSTONE_DAYS`. Nothing else about
     * the account changes: friends, scores, invites and challenges are untouched
     * and simply render the generated name. The player can pick a new name
     * through the normal settings flow (no cooldown applies while `username` is
     * NULL).
     *
     * `found: false`: no such report. `changed: false` with `found: true`: it was
     * already closed, and the account is NOT touched (a stale queue must not
     * reset a profile someone else already dealt with). `publicId` is returned
     * for the audit log line, never the internal id.
     */
    async actionAccount(input: {
      id: number;
      actorEmail: string;
    }): Promise<{
      found: boolean;
      changed: boolean;
      reportsClosed: number;
      publicId: string | null;
    }> {
      const { id, actorEmail } = input;
      const rows = (await sql`
        WITH rep AS (
          SELECT reported_id FROM profile_reports WHERE id = ${id} AND status = 'open'
        ),
        old AS (
          SELECT id, public_id, username FROM players
           WHERE id = (SELECT reported_id FROM rep)
        ),
        tomb AS (
          INSERT INTO username_history (username, player_id)
          SELECT username, NULL FROM old WHERE username IS NOT NULL
          ON CONFLICT (username) DO UPDATE SET player_id = NULL, released_at = now()
          RETURNING username
        ),
        pl AS (
          UPDATE players
             SET handle = NULL, username = NULL, use_google_photo = false
           WHERE id = (SELECT id FROM old)
          RETURNING id
        ),
        rp AS (
          UPDATE profile_reports
             SET status = 'actioned', resolved_at = now(), resolved_by = ${actorEmail}::text
           WHERE reported_id = (SELECT reported_id FROM rep) AND status = 'open'
          RETURNING id
        )
        SELECT EXISTS (SELECT 1 FROM profile_reports WHERE id = ${id}) AS found,
               (SELECT count(*) FROM rp)  AS closed,
               (SELECT count(*) FROM pl)  AS cleared,
               (SELECT count(*) FROM tomb) AS tombstoned,
               (SELECT public_id FROM old) AS public_id
      `) as Row[];
      const row = rows[0] ?? {};
      return {
        found: row.found === true,
        changed: toInt(row.closed) > 0,
        reportsClosed: toInt(row.closed),
        publicId: row.public_id == null ? null : String(row.public_id),
      };
    },

    /**
     * Delete resolved reports more than `days` after they were resolved. Open
     * reports are never touched. Idempotent; a repeat run deletes nothing more.
     * Rows with a NULL `resolved_at` and a non-open status cannot exist through
     * the app, but would be kept rather than guessed at.
     */
    async purgeResolved(days: number): Promise<{ deleted: number }> {
      const rows = (await sql`
        WITH del AS (
          DELETE FROM profile_reports
           WHERE status <> 'open'
             AND resolved_at < now() - make_interval(days => ${days}::int)
          RETURNING id
        )
        SELECT count(*)::int AS n FROM del
      `) as Row[];
      return { deleted: toInt(rows[0]?.n) };
    },

    /** How many resolved reports are past retention (for a dry run). */
    async countPurgeable(days: number): Promise<number> {
      const rows = (await sql`
        SELECT count(*)::int AS n FROM profile_reports
         WHERE status <> 'open'
           AND resolved_at < now() - make_interval(days => ${days}::int)
      `) as Row[];
      return toInt(rows[0]?.n);
    },

    async openCount(): Promise<number> {
      const rows = (await sql`
        SELECT count(*)::int AS n FROM profile_reports WHERE status = 'open'
      `) as Row[];
      return toInt(rows[0]?.n);
    },

    /**
     * Close one OPEN report. `found: false` means no such report (stale queue);
     * `changed: false` with `found: true` means someone else already closed it.
     */
    async resolve(input: {
      id: number;
      status: "actioned" | "dismissed";
      actorEmail: string;
    }): Promise<{ found: boolean; changed: boolean }> {
      const { id, status, actorEmail } = input;
      const rows = (await sql`
        WITH upd AS (
          UPDATE profile_reports
             SET status = ${status}::text, resolved_at = now(), resolved_by = ${actorEmail}::text
           WHERE id = ${id} AND status = 'open'
          RETURNING id
        )
        SELECT EXISTS (SELECT 1 FROM profile_reports WHERE id = ${id}) AS found,
               (SELECT count(*) FROM upd) AS changed
      `) as Row[];
      const row = rows[0] ?? {};
      return { found: row.found === true, changed: toInt(row.changed) > 0 };
    },
  };
}

export type ProfileReportStore = ReturnType<typeof createProfileReportStore>;
