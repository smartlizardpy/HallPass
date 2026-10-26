/**
 * HallPass — championship store. Every statement the championship runs.
 *
 * A factory over an injected `sql` (the house pattern: `createStore`,
 * `createAchievementStore`), so tests pass a fake and the barrel binds the live
 * Neon client. No `server-only` import here for the same reason; the barrel has
 * it.
 *
 * ONE STATEMENT PER CHANGE. The HTTP driver cannot hold a transaction across
 * calls, so every write is a single statement whose WHERE clause is its own
 * guard: a run is completed only `WHERE status = 'issued'`, a review only from
 * the statuses it may leave, and every admin change writes its
 * `championship_log` row in the same statement (a data-modifying CTE). A
 * statement that matches nothing changed nothing, and the caller re-reads to
 * say why.
 *
 * THE DATABASE CLOCK DECIDES. Elapsed time, expiry and every "now" come from
 * `now()` in the statement, never from the web server or the browser.
 *
 * PRIVACY. Player rows are selected for `public_id`, `handle`, `username` and the
 * meme-avatar choice only. Never `name`, `email` or `image` (the Google name is
 * often a child's real name; see `scoreboard/store.ts` getTopScores).
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import { memeAvatarFor } from "../avatars";
import { placeholderName, publicScoreName } from "../scoreboard/display-name";
import type { BestRun } from "./standings";
import type { EventState, EventStatus, GameState, GameStatus, MetricSpec, RunStatus } from "./types";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

const toIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};
const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The public name and avatar of a joined player row. Never the Google name or photo. */
export function publicPlayer(row: Row): { publicId: string; name: string; avatar: string } {
  const publicId = row.p_public_id == null ? "" : String(row.p_public_id);
  if (!publicId) return { publicId: "", name: placeholderName(null), avatar: "" };
  return {
    publicId,
    name: publicScoreName({ handle: str(row.p_handle), username: str(row.p_username), publicId }),
    avatar: memeAvatarFor(publicId, { meme: row.p_avatar_meme, colour: row.p_avatar_colour }),
  };
}

export interface EventSnapshot {
  state: EventState;
  games: GameState[];
  /** The database clock when this was read, epoch ms. */
  nowMs: number;
}

export interface IssuedToken {
  runId: number;
  issuedAt: string;
  expiresAt: string;
}

export interface RunForSubmission {
  id: number;
  status: RunStatus;
  seed: number | null;
  issuedAt: string;
  expired: boolean;
  elapsedSec: number;
  nowMs: number;
  score: number | null;
  tiebreak: number | null;
  flags: string[];
  reason: string | null;
  submittedAt: string | null;
}

export interface CompleteRunInput {
  runId: number;
  playerId: string;
  eventId: string;
  gameSlug: string;
  status: Extract<RunStatus, "accepted" | "flagged" | "rejected">;
  score: number | null;
  tiebreak: number | null;
  meta: Record<string, unknown>;
  checks: Record<string, unknown>;
  flags: string[];
  reason: string | null;
  /** Minimum seconds between two submissions by one player on one board. */
  minGapSec: number;
}

/** A run as an admin sees it. Carries the player's public id and public name only. */
export interface AdminRun {
  id: number;
  gameSlug: string;
  publicId: string;
  name: string;
  status: RunStatus;
  score: number | null;
  tiebreak: number | null;
  issuedAt: string;
  submittedAt: string | null;
  elapsedSec: number | null;
  flags: string[];
  reason: string | null;
  meta: unknown;
  checks: unknown;
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** True when the run belongs to the given dashboard user's own player account. */
  isOwn: boolean;
}

/** A run as its own player sees it. */
export interface PlayerRun {
  id: number;
  gameSlug: string;
  status: RunStatus;
  score: number | null;
  tiebreak: number | null;
  submittedAt: string | null;
  reason: string | null;
}

export interface LogEntry {
  id: number;
  actorEmail: string;
  action: string;
  runId: number | null;
  gameSlug: string | null;
  publicId: string | null;
  reason: string | null;
  data: unknown;
  createdAt: string;
}

export type ReviewAction = "approve-run" | "disqualify-run" | "reinstate-run";
export type GameAction = "open-game" | "pause-game" | "resume-game" | "withdraw-game";
export type EventAction = "suspend" | "resume" | "close-early" | "reopen" | "start-verification" | "archive";

/** From which statuses each review may move a run, and to what. */
export const REVIEW_TRANSITIONS: Record<ReviewAction, { from: RunStatus[]; to: RunStatus }> = {
  "approve-run": { from: ["flagged"], to: "accepted" },
  "disqualify-run": { from: ["accepted", "flagged"], to: "disqualified" },
  "reinstate-run": { from: ["disqualified"], to: "accepted" },
};

export const GAME_TRANSITIONS: Record<GameAction, { from: GameStatus[]; to: GameStatus }> = {
  "open-game": { from: ["pending"], to: "open" },
  "pause-game": { from: ["open"], to: "paused" },
  "resume-game": { from: ["paused"], to: "open" },
  "withdraw-game": { from: ["pending", "open", "paused"], to: "withdrawn" },
};

function mapRunStatus(v: unknown): RunStatus {
  return v === "accepted" || v === "flagged" || v === "rejected" || v === "disqualified" ? v : "issued";
}

export function createChampionshipStore(sql: Sql) {
  /** The event row, its lineup and the database clock, in one read. `null` when the event row is missing. */
  async function readEvent(eventId: string): Promise<EventSnapshot | null> {
    const rows = (await sql`
      SELECT e.status, e.suspended, e.suspended_reason, e.closed_early_at, e.finalised_at,
             (extract(epoch FROM now()) * 1000)::float8 AS now_ms,
             COALESCE(
               (SELECT json_agg(json_build_object('slug', g.game_slug, 'status', g.status, 'openedAt', g.opened_at)
                                ORDER BY g.game_slug)
                  FROM championship_games g WHERE g.event_id = e.id),
               '[]'::json
             ) AS games
      FROM championship_events e
      WHERE e.id = ${eventId}
    `) as Row[];
    const r = rows[0];
    if (!r) return null;
    const games = (Array.isArray(r.games) ? r.games : []) as Row[];
    return {
      state: {
        status: (["scheduled", "verification", "finalised", "archived"].includes(String(r.status))
          ? r.status
          : "scheduled") as EventStatus,
        suspended: r.suspended === true,
        suspendedReason: str(r.suspended_reason),
        closedEarlyAt: toIso(r.closed_early_at),
        finalisedAt: toIso(r.finalised_at),
      },
      games: games.map((g) => ({
        slug: String(g.slug),
        status: (["pending", "open", "paused", "withdrawn"].includes(String(g.status)) ? g.status : "pending") as GameStatus,
        openedAt: toIso(g.openedAt),
      })),
      nowMs: toNum(r.now_ms) ?? Date.now(),
    };
  }

  /**
   * Issue a run token, unless the player has issued `limit` in the last
   * `windowSec` seconds (counted in the same statement as the insert). Returns
   * `null` when rate-limited.
   */
  async function issueToken(input: {
    eventId: string;
    gameSlug: string;
    playerId: string;
    tokenHash: string;
    seed: number | null;
    ttlSec: number;
    limit: number;
    windowSec: number;
  }): Promise<IssuedToken | null> {
    const rows = (await sql`
      WITH recent AS (
        SELECT count(*)::int AS n FROM championship_runs
        WHERE player_id = ${input.playerId} AND event_id = ${input.eventId}
          AND issued_at > now() - make_interval(secs => ${input.windowSec})
      ), ins AS (
        INSERT INTO championship_runs (event_id, game_slug, player_id, token_hash, seed, expires_at)
        SELECT ${input.eventId}, ${input.gameSlug}, ${input.playerId}, ${input.tokenHash}, ${input.seed},
               now() + make_interval(secs => ${input.ttlSec})
        FROM recent WHERE recent.n < ${input.limit}
        RETURNING id, issued_at, expires_at
      )
      SELECT id, issued_at, expires_at FROM ins
    `) as Row[];
    const r = rows[0];
    if (!r) return null;
    return { runId: Number(r.id), issuedAt: toIso(r.issued_at)!, expiresAt: toIso(r.expires_at)! };
  }

  /**
   * The run a token names, if it belongs to THIS player on THIS board. A token
   * issued to anyone else reads as not found: that is the impersonation guard.
   */
  async function findRun(input: {
    tokenHash: string;
    playerId: string;
    eventId: string;
    gameSlug: string;
  }): Promise<RunForSubmission | null> {
    const rows = (await sql`
      SELECT id, status, seed, issued_at, score, tiebreak, flags, reason, submitted_at,
             (now() > expires_at) AS expired,
             extract(epoch FROM (now() - issued_at))::float8 AS elapsed_sec,
             (extract(epoch FROM now()) * 1000)::float8 AS now_ms
      FROM championship_runs
      WHERE token_hash = ${input.tokenHash} AND player_id = ${input.playerId}
        AND event_id = ${input.eventId} AND game_slug = ${input.gameSlug}
    `) as Row[];
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      status: mapRunStatus(r.status),
      seed: toNum(r.seed),
      issuedAt: toIso(r.issued_at)!,
      expired: r.expired === true,
      elapsedSec: toNum(r.elapsed_sec) ?? 0,
      nowMs: toNum(r.now_ms) ?? Date.now(),
      score: toNum(r.score),
      tiebreak: toNum(r.tiebreak),
      flags: Array.isArray(r.flags) ? r.flags.map(String) : [],
      reason: str(r.reason),
      submittedAt: toIso(r.submitted_at),
    };
  }

  /**
   * Complete a run exactly once. Guarded by `status = 'issued'` (single use) and
   * by a per-player gap between submissions on the board. Returns `null` when
   * the statement matched nothing; the caller re-reads to tell a duplicate from
   * a rate limit.
   */
  async function completeRun(input: CompleteRunInput): Promise<{ id: number; status: RunStatus; submittedAt: string } | null> {
    const rows = (await sql`
      UPDATE championship_runs SET
        status = ${input.status},
        score = ${input.score},
        tiebreak = ${input.tiebreak},
        meta = ${JSON.stringify(input.meta)}::jsonb,
        checks = ${JSON.stringify(input.checks)}::jsonb,
        flags = ${input.flags}::text[],
        reason = ${input.reason},
        submitted_at = now()
      WHERE id = ${input.runId} AND player_id = ${input.playerId} AND status = 'issued'
        AND NOT EXISTS (
          SELECT 1 FROM championship_runs o
          WHERE o.player_id = ${input.playerId} AND o.event_id = ${input.eventId} AND o.game_slug = ${input.gameSlug}
            AND o.id <> ${input.runId}
            AND o.submitted_at > now() - make_interval(secs => ${input.minGapSec})
        )
      RETURNING id, status, submitted_at
    `) as Row[];
    const r = rows[0];
    return r ? { id: Number(r.id), status: mapRunStatus(r.status), submittedAt: toIso(r.submitted_at)! } : null;
  }

  /**
   * Each player's best ACCEPTED run per board, with public identity. The order
   * mirrors `compareRuns` (which re-sorts in TypeScript and is the definition);
   * `sign` turns every metric into "higher sorts first" so one template serves
   * both directions without interpolating SQL.
   */
  async function bestRuns(
    eventId: string,
    games: ReadonlyArray<{ slug: string; metric: MetricSpec }>,
  ): Promise<BestRun[]> {
    if (!games.length) return [];
    const slugs = games.map((g) => g.slug);
    const scoreSign = games.map((g) => (g.metric.sort === "desc" ? 1 : -1));
    const tieSign = games.map((g) => (g.metric.tiebreakSort === "desc" ? 1 : -1));
    const rows = (await sql`
      WITH cfg AS (
        SELECT * FROM unnest(${slugs}::text[], ${scoreSign}::int[], ${tieSign}::int[]) AS c(game_slug, s_sign, t_sign)
      ), best AS (
        SELECT DISTINCT ON (r.game_slug, r.player_id)
               r.id, r.game_slug, r.player_id, r.score, r.tiebreak, r.submitted_at
        FROM championship_runs r JOIN cfg c ON c.game_slug = r.game_slug
        WHERE r.event_id = ${eventId} AND r.status = 'accepted'
        ORDER BY r.game_slug, r.player_id,
                 r.score * c.s_sign DESC,
                 r.tiebreak * c.t_sign DESC NULLS LAST,
                 r.submitted_at ASC, r.id ASC
      )
      SELECT b.*, p.public_id AS p_public_id, p.handle AS p_handle, p.username AS p_username,
             p.avatar_meme AS p_avatar_meme, p.avatar_colour AS p_avatar_colour
      FROM best b JOIN players p ON p.id = b.player_id
    `) as Row[];
    return rows.map((r) => ({
      runId: Number(r.id),
      gameSlug: String(r.game_slug),
      playerId: String(r.player_id),
      ...publicPlayer(r),
      score: toNum(r.score) ?? 0,
      tiebreak: toNum(r.tiebreak),
      submittedAt: toIso(r.submitted_at)!,
    }));
  }

  /** A player's own recent runs (submitted only), newest first. */
  async function playerRuns(eventId: string, playerId: string, limit = 20): Promise<PlayerRun[]> {
    const rows = (await sql`
      SELECT id, game_slug, status, score, tiebreak, submitted_at, reason
      FROM championship_runs
      WHERE event_id = ${eventId} AND player_id = ${playerId} AND status <> 'issued'
      ORDER BY submitted_at DESC, id DESC
      LIMIT ${Math.max(1, Math.min(100, limit))}
    `) as Row[];
    return rows.map((r) => ({
      id: Number(r.id),
      gameSlug: String(r.game_slug),
      status: mapRunStatus(r.status),
      score: toNum(r.score),
      tiebreak: toNum(r.tiebreak),
      submittedAt: toIso(r.submitted_at),
      reason: str(r.reason),
    }));
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  /** Submitted runs for the dashboard, newest first. `ownPlayerId` marks the viewer's own runs. */
  async function listRuns(
    eventId: string,
    opts: { status?: RunStatus | null; gameSlug?: string | null; limit?: number; ownPlayerId?: string | null },
  ): Promise<AdminRun[]> {
    const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
    const rows = (await sql`
      SELECT r.id, r.game_slug, r.player_id, r.status, r.score, r.tiebreak, r.issued_at, r.submitted_at,
             extract(epoch FROM (r.submitted_at - r.issued_at))::float8 AS elapsed_sec,
             r.flags, r.reason, r.meta, r.checks, r.reviewed_by, r.reviewed_at,
             p.public_id AS p_public_id, p.handle AS p_handle, p.username AS p_username,
             p.avatar_meme AS p_avatar_meme, p.avatar_colour AS p_avatar_colour
      FROM championship_runs r JOIN players p ON p.id = r.player_id
      WHERE r.event_id = ${eventId} AND r.status <> 'issued'
        AND (${opts.status ?? null}::text IS NULL OR r.status = ${opts.status ?? null})
        AND (${opts.gameSlug ?? null}::text IS NULL OR r.game_slug = ${opts.gameSlug ?? null})
      ORDER BY (r.status = 'flagged') DESC, r.submitted_at DESC, r.id DESC
      LIMIT ${limit}
    `) as Row[];
    return rows.map((r) => {
      const who = publicPlayer(r);
      return {
        id: Number(r.id),
        gameSlug: String(r.game_slug),
        publicId: who.publicId,
        name: who.name,
        status: mapRunStatus(r.status),
        score: toNum(r.score),
        tiebreak: toNum(r.tiebreak),
        issuedAt: toIso(r.issued_at)!,
        submittedAt: toIso(r.submitted_at),
        elapsedSec: toNum(r.elapsed_sec),
        flags: Array.isArray(r.flags) ? r.flags.map(String) : [],
        reason: str(r.reason),
        meta: r.meta ?? null,
        checks: r.checks ?? null,
        reviewedBy: str(r.reviewed_by),
        reviewedAt: toIso(r.reviewed_at),
        isOwn: opts.ownPlayerId != null && String(r.player_id) === opts.ownPlayerId,
      };
    });
  }

  /** Counts per status, for the dashboard header. */
  async function runCounts(eventId: string): Promise<Record<RunStatus, number>> {
    const rows = (await sql`
      SELECT status, count(*)::int AS n FROM championship_runs WHERE event_id = ${eventId} GROUP BY status
    `) as Row[];
    const out: Record<RunStatus, number> = { issued: 0, accepted: 0, flagged: 0, rejected: 0, disqualified: 0 };
    for (const r of rows) out[mapRunStatus(r.status)] = Number(r.n) || 0;
    return out;
  }

  /**
   * Review one run. Refused (returns false) when the run is not in a status the
   * action may leave, when it is the reviewer's own run, or when the event is
   * already finalised. The log row is written by the same statement.
   */
  async function reviewRun(input: {
    eventId: string;
    runId: number;
    action: ReviewAction;
    actorEmail: string;
    actorPlayerId: string | null;
    reason: string | null;
  }): Promise<boolean> {
    const t = REVIEW_TRANSITIONS[input.action];
    const rows = (await sql`
      WITH upd AS (
        UPDATE championship_runs SET
          status = ${t.to},
          reviewed_by = ${input.actorEmail},
          reviewed_at = now(),
          reason = COALESCE(${input.reason}, reason)
        WHERE id = ${input.runId} AND event_id = ${input.eventId}
          AND status = ANY(${t.from}::text[])
          AND player_id IS DISTINCT FROM ${input.actorPlayerId}
          AND EXISTS (SELECT 1 FROM championship_events e
                      WHERE e.id = ${input.eventId} AND e.status IN ('scheduled','verification'))
        RETURNING id, game_slug, player_id
      ), log AS (
        INSERT INTO championship_log (event_id, actor_email, action, run_id, game_slug, player_id, reason)
        SELECT ${input.eventId}, ${input.actorEmail}, ${input.action}, id, game_slug, player_id, ${input.reason}
        FROM upd
        RETURNING id
      )
      SELECT (SELECT count(*)::int FROM upd) AS changed, (SELECT count(*)::int FROM log) AS logged
    `) as Row[];
    return Number(rows[0]?.changed) === 1;
  }

  /** Move one game's board through its lifecycle, logged in the same statement. */
  async function setGameStatus(input: {
    eventId: string;
    gameSlug: string;
    action: GameAction;
    actorEmail: string;
    reason: string | null;
  }): Promise<boolean> {
    const t = GAME_TRANSITIONS[input.action];
    // A game added to the config after the migration has no row: it is
    // implicitly pending, so only the moves out of pending may create one.
    // (Not INSERT … ON CONFLICT: Postgres checks the proposed row's CHECK
    // constraint before resolving the conflict, which would reject a pause.)
    const fromPending = t.from.includes("pending");
    const rows = (await sql`
      WITH upd AS (
        UPDATE championship_games SET
          status = ${t.to},
          opened_at = COALESCE(opened_at, CASE WHEN ${t.to} = 'open' THEN now() END),
          updated_at = now()
        WHERE event_id = ${input.eventId} AND game_slug = ${input.gameSlug}
          AND status = ANY(${t.from}::text[])
        RETURNING game_slug
      ), ins AS (
        INSERT INTO championship_games (event_id, game_slug, status, opened_at)
        SELECT ${input.eventId}, ${input.gameSlug}, ${t.to}, CASE WHEN ${t.to} = 'open' THEN now() END
        WHERE ${fromPending}
          AND NOT EXISTS (SELECT 1 FROM championship_games
                          WHERE event_id = ${input.eventId} AND game_slug = ${input.gameSlug})
        ON CONFLICT (event_id, game_slug) DO NOTHING
        RETURNING game_slug
      ), changed AS (
        SELECT game_slug FROM upd UNION ALL SELECT game_slug FROM ins
      ), log AS (
        INSERT INTO championship_log (event_id, actor_email, action, game_slug, reason)
        SELECT ${input.eventId}, ${input.actorEmail}, ${input.action}, game_slug, ${input.reason} FROM changed
        RETURNING id
      )
      SELECT (SELECT count(*)::int FROM changed) AS changed, (SELECT count(*)::int FROM log) AS logged
    `) as Row[];
    return Number(rows[0]?.changed) === 1;
  }

  /**
   * Event-level actions. Each is one guarded UPDATE plus its log row. The
   * caller checks the clock-dependent preconditions (start verification only
   * after the close, reopen only before it) with `phase.ts`; the SQL guards the
   * stored state so two admins cannot race each other into a bad state.
   */
  async function setEventState(input: {
    eventId: string;
    action: EventAction;
    actorEmail: string;
    reason: string | null;
  }): Promise<boolean> {
    const a = input.action;
    const rows = (await sql`
      WITH upd AS (
        UPDATE championship_events SET
          suspended = CASE WHEN ${a} = 'suspend' THEN true WHEN ${a} = 'resume' THEN false ELSE suspended END,
          suspended_reason = CASE WHEN ${a} = 'suspend' THEN ${input.reason} WHEN ${a} = 'resume' THEN NULL ELSE suspended_reason END,
          closed_early_at = CASE WHEN ${a} = 'close-early' THEN now() WHEN ${a} = 'reopen' THEN NULL ELSE closed_early_at END,
          status = CASE WHEN ${a} = 'start-verification' THEN 'verification'
                        WHEN ${a} = 'archive' THEN 'archived' ELSE status END,
          updated_at = now()
        WHERE id = ${input.eventId} AND (
             (${a} = 'suspend' AND NOT suspended AND status IN ('scheduled','verification'))
          OR (${a} = 'resume' AND suspended)
          OR (${a} = 'close-early' AND closed_early_at IS NULL AND status = 'scheduled')
          OR (${a} = 'reopen' AND closed_early_at IS NOT NULL AND status = 'scheduled')
          OR (${a} = 'start-verification' AND status = 'scheduled')
          OR (${a} = 'archive' AND status = 'finalised')
        )
        RETURNING id
      ), log AS (
        INSERT INTO championship_log (event_id, actor_email, action, reason)
        SELECT id, ${input.actorEmail}, ${a}, ${input.reason} FROM upd
        RETURNING id
      )
      SELECT (SELECT count(*)::int FROM upd) AS changed, (SELECT count(*)::int FROM log) AS logged
    `) as Row[];
    return Number(rows[0]?.changed) === 1;
  }

  /**
   * Freeze the result. Only from `verification`, and only while no run is
   * waiting for review (in the same statement, so a run flagged a moment ago
   * cannot slip past). `snapshot` holds public ids and points only.
   */
  async function finalise(input: { eventId: string; actorEmail: string; snapshot: unknown }): Promise<boolean> {
    const rows = (await sql`
      WITH upd AS (
        UPDATE championship_events SET
          status = 'finalised',
          final_standings = ${JSON.stringify(input.snapshot)}::jsonb,
          finalised_at = now(),
          finalised_by = ${input.actorEmail},
          suspended = false,
          updated_at = now()
        WHERE id = ${input.eventId} AND status = 'verification'
          AND NOT EXISTS (SELECT 1 FROM championship_runs WHERE event_id = ${input.eventId} AND status = 'flagged')
        RETURNING id
      ), log AS (
        INSERT INTO championship_log (event_id, actor_email, action)
        SELECT id, ${input.actorEmail}, 'finalise' FROM upd
        RETURNING id
      )
      SELECT (SELECT count(*)::int FROM upd) AS changed, (SELECT count(*)::int FROM log) AS logged
    `) as Row[];
    return Number(rows[0]?.changed) === 1;
  }

  /** The frozen result, or `null` before finalisation. */
  async function finalStandings(eventId: string): Promise<unknown | null> {
    const rows = (await sql`SELECT final_standings FROM championship_events WHERE id = ${eventId}`) as Row[];
    return rows[0]?.final_standings ?? null;
  }

  /** Record a non-state admin action (e.g. a rewards run) in the log. */
  async function logAction(input: {
    eventId: string;
    actorEmail: string;
    action: "grant-rewards";
    reason: string | null;
    data: unknown;
  }): Promise<void> {
    await sql`
      INSERT INTO championship_log (event_id, actor_email, action, reason, data)
      VALUES (${input.eventId}, ${input.actorEmail}, ${input.action}, ${input.reason}, ${JSON.stringify(input.data)}::jsonb)
    `;
  }

  async function readLog(eventId: string, limit = 100): Promise<LogEntry[]> {
    const rows = (await sql`
      SELECT l.id, l.actor_email, l.action, l.run_id, l.game_slug, l.reason, l.data, l.created_at,
             p.public_id AS p_public_id
      FROM championship_log l LEFT JOIN players p ON p.id = l.player_id
      WHERE l.event_id = ${eventId}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ${Math.max(1, Math.min(500, limit))}
    `) as Row[];
    return rows.map((r) => ({
      id: Number(r.id),
      actorEmail: String(r.actor_email),
      action: String(r.action),
      runId: toNum(r.run_id),
      gameSlug: str(r.game_slug),
      publicId: r.p_public_id == null ? null : String(r.p_public_id),
      reason: str(r.reason),
      data: r.data ?? null,
      createdAt: toIso(r.created_at)!,
    }));
  }

  /** Current public names for public ids (a deleted account is simply absent). */
  async function publicPlayers(publicIds: string[]): Promise<Map<string, { name: string; avatar: string }>> {
    const ids = publicIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (!ids.length) return new Map();
    const rows = (await sql`
      SELECT public_id AS p_public_id, handle AS p_handle, username AS p_username,
             avatar_meme AS p_avatar_meme, avatar_colour AS p_avatar_colour
      FROM players WHERE public_id = ANY(${ids}::uuid[])
    `) as Row[];
    return new Map(rows.map((r) => {
      const p = publicPlayer(r);
      return [p.publicId, { name: p.name, avatar: p.avatar }] as const;
    }));
  }

  /** Internal ids for public ids, server-side only (reward grants). */
  async function internalIds(publicIds: string[]): Promise<Map<string, string>> {
    const ids = publicIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (!ids.length) return new Map();
    const rows = (await sql`SELECT id, public_id FROM players WHERE public_id = ANY(${ids}::uuid[])`) as Row[];
    return new Map(rows.map((r) => [String(r.public_id), String(r.id)] as const));
  }

  return {
    readEvent,
    issueToken,
    findRun,
    completeRun,
    bestRuns,
    playerRuns,
    listRuns,
    runCounts,
    reviewRun,
    setGameStatus,
    setEventState,
    finalise,
    finalStandings,
    logAction,
    readLog,
    publicPlayers,
    internalIds,
  };
}

export type ChampionshipStore = ReturnType<typeof createChampionshipStore>;
