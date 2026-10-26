/**
 * HallPass — Candy Hunt store. Every statement Halloween Candy runs.
 *
 * A factory over an injected `sql` (the house pattern: `createCollectiblesStore`),
 * so tests pass a fake and the barrel binds the live Neon client. No
 * `server-only` import here for the same reason; the barrel has it.
 *
 * THE LEDGER IS THE TRUTH. `candy_ledger` is append-only: a balance is
 * `sum(amount) WHERE revoked_at IS NULL`, so there is no counter to drift. Every
 * credit carries a unique `award_key` (`candy:<event>:<kind>:<player>:<ref>`) and
 * is written `ON CONFLICT (award_key) DO NOTHING`, so syncing twice, from two
 * tabs, or from two requests at once pays once.
 *
 * SYNC PULLS, IT IS NOT PUSHED. Nothing calls "award candy" when a score is set
 * or a run is accepted (those paths belong to other systems, and a hook there
 * could fail the player's real action). Instead `sync(playerId)` reads what
 * those systems already recorded and inserts whatever is missing. That is also
 * why rating a board AFTER a score was set still pays: the next sync finds it.
 * The four sources:
 *   - daily bests: for each (signed-in player, board, UK day) in the earning
 *     window, the player's best row that day (`scoreboard/rank.ts` order), on a
 *     board with a `game_slug` and `candy` above 0 at sync time. It pays by the
 *     rank that row held WHEN IT WAS SET (`1 + strictly-better rows no newer than
 *     it`, the `rankForScore` rule restricted to rows that existed then and to
 *     the event window: during Fright Fest the leaderboards show only scores set
 *     from `opensAt`, so earlier rows never count, not even to rank), so a later
 *     score never changes a payout. Achievements pay nothing (they are
 *     self-reported);
 *   - ranked runs: a player's first ACCEPTED run on each counting board;
 *   - all boards: once, when the championship is finalised and the player's
 *     overall entry in the FROZEN snapshot is `eligible` (a result on every
 *     board);
 *   - placings: only when the championship is finalised, from the same FROZEN
 *     snapshot (never from live standings), by final rank.
 * A counting board is `open` or `paused` with an `opened_at`, exactly as
 * `championship/phase.ts#countingGames` defines it.
 *
 * AUTOMATIC REVOCATION covers one case: a ranked-run credit whose board no longer
 * has an accepted run for the player (the run was rejected or disqualified) is
 * revoked with `revoked_by = 'system'`, and restored if an accepted run comes
 * back (a reinstated run). Only a system revocation is ever restored; an admin's
 * stays. Both run in the same transaction as the sync, behind the same advisory
 * lock a spend takes, so a revocation can never slip between a spend's balance
 * check and its debit. The all-boards bonus and placings are never revoked
 * automatically: they are paid from the verified, frozen final results, so they
 * are final the moment they are paid (an admin can still revoke one by hand).
 * They are deliberately not paid from live boards: one early run on a single
 * open board would otherwise earn "a result on every board".
 *
 * A SPEND IS ONE TRANSACTION. `spend` takes a per-player advisory lock, then runs
 * ONE statement that checks the balance, grants the sealed pack (a `player_packs`
 * row identical to `grantPack`'s, `source = 'event'`, grant key = the debit's
 * award key) and writes the debit linked to that pack. If the balance is short
 * the statement inserts nothing. The same `requestId` can never buy twice: it is
 * part of the award key, and the grant key is the same string.
 *
 * THE DATABASE CLOCK DECIDES. Spending opens at the event and ends at
 * `spendUntil`; both are compared with `now()` inside the statement.
 *
 * PRIVACY. Player rows are selected for `public_id`, `handle` and `username`
 * only. Never `name`, `email` or `image`.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import { publicScoreName } from "../scoreboard/display-name";
import { currentVersion, getPack } from "../collectibles/catalogue";
import { CANDY_FRIGHT_FEST_2026, isGameCandy, type CandyConfig } from "./fright-fest-2026";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

export const CANDY_KINDS = ["daily_best", "ranked_run", "all_boards", "placing", "spend"] as const;
export type CandyKind = (typeof CANDY_KINDS)[number];

/** A board id's format (`boards_id_format`). */
export const BOARD_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** A request id is chosen by the client (a uuid); this is the whole alphabet it may use. */
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const toIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const kindOf = (v: unknown): CandyKind => ((CANDY_KINDS as readonly string[]).includes(String(v)) ? (v as CandyKind) : "daily_best");

/** A reason an admin typed: required, trimmed, at most 500 characters. */
export function cleanReason(reason: string): string {
  const r = reason.trim();
  if (!r || r.length > 500) throw new Error("A reason of 1 to 500 characters is required");
  return r;
}

export interface SyncResult {
  /** Credits written by THIS call (0 on a repeat). */
  credited: number;
  /** Candy those credits are worth. */
  amount: number;
}

export interface LedgerEntry {
  id: number;
  kind: CandyKind;
  amount: number;
  /** '<boardId>#<YYYY-MM-DD>#<rank>' for a daily best, a board slug, 'slug#rank' for a placing, a pack id for a spend. */
  ref: string | null;
  /** The game of a daily-best credit's board, else null. */
  gameSlug: string | null;
  createdAt: string;
  revoked: boolean;
}

export type SpendResult =
  | { status: "ok"; alreadySpent: boolean; packPublicId: string; packId: string; price: number; balance: number }
  | { status: "bad-pack" }
  | { status: "bad-request" }
  | { status: "closed"; reason: "not-open-yet" | "expired" }
  | { status: "insufficient"; balance: number; price: number };

export interface AdminBoard {
  id: string;
  gameSlug: string;
  title: string;
  sort: "asc" | "desc";
  /** The rank-1 payout; 0 pays nothing. */
  candy: number;
  /** Scores by signed-in players inside the earning window. */
  scoresInWindow: number;
  /** Distinct signed-in players with a score inside the window. */
  playersInWindow: number;
}

/** One ledger row on the admin's feed, with the player's PUBLIC name. */
export interface AdminLedgerRow {
  id: number;
  kind: CandyKind;
  amount: number;
  ref: string | null;
  /** The game of a daily-best credit's board, else null. */
  gameSlug: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedReason: string | null;
  player: { publicId: string; name: string };
}

export interface CandyLogEntry {
  id: number;
  actorEmail: string;
  action: string;
  publicId: string | null;
  name: string | null;
  reason: string | null;
  data: unknown;
  createdAt: string;
}

export interface TopEarner {
  player: { publicId: string; name: string };
  /** Unrevoked credits, all kinds. */
  credited: number;
  /** Unrevoked daily-best credits: the amount and how many. */
  dailyBestTotal: number;
  dailyBestCount: number;
  /** The best (lowest) rank among those credits, or null when there are none. */
  bestRank: number | null;
  spent: number;
  balance: number;
}

export interface CandyStats {
  /** Players with at least one credit. */
  players: number;
  credited: number;
  spent: number;
  revoked: number;
}

export type SetValueResult = "changed" | "unchanged" | "not-found";

export function createCandyStore(sql: Sql, config: CandyConfig = CANDY_FRIGHT_FEST_2026) {
  const event = config.id;
  const lockKey = (playerId: string) => `candy:${playerId}`;
  const tiers = {
    from: config.placing.map((t) => t.from),
    to: config.placing.map((t) => t.to),
    amount: config.placing.map((t) => t.amount),
  };

  /**
   * Bring one player's ledger up to date with what the scoreboard and
   * championship systems recorded. Idempotent; safe to call on every page view.
   * ONE transaction (one HTTP round trip): the advisory lock, the two
   * revocation statements, then the four credit inserts.
   */
  async function sync(playerId: string): Promise<SyncResult> {
    const results = await sql.transaction((tx) => [
      tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(playerId)}, 0))`,
      // A ranked-run credit whose board has no accepted run for the player any more.
      tx`
        UPDATE candy_ledger l
        SET revoked_at = now(), revoked_by = 'system', revoked_reason = 'No accepted run on this board'
        WHERE l.player_id = ${playerId} AND l.event_id = ${event} AND l.kind = 'ranked_run' AND l.revoked_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM championship_runs r
            WHERE r.event_id = l.event_id AND r.player_id = l.player_id AND r.game_slug = l.ref AND r.status = 'accepted'
          )
      `,
      // ... and the reverse: an accepted run is back (a reinstated run). Only the system's own revocations.
      tx`
        UPDATE candy_ledger l
        SET revoked_at = NULL, revoked_by = NULL, revoked_reason = NULL
        WHERE l.player_id = ${playerId} AND l.event_id = ${event} AND l.kind = 'ranked_run'
          AND l.revoked_at IS NOT NULL AND l.revoked_by = 'system'
          AND EXISTS (
            SELECT 1 FROM championship_runs r
            WHERE r.event_id = l.event_id AND r.player_id = l.player_id AND r.game_slug = l.ref AND r.status = 'accepted'
          )
      `,
      // Daily bests: one credit per (player, board, UK day) in the window, on a board rated above 0 now.
      // `best` is the player's top row of that day (rank.ts order: score by the board's sort, earlier created_at,
      // lower id). Its rank counts strictly-better rows on the board's HALLOWEEN board (rows set from `opensAt`, since
      // the leaderboards show only event scores) that were no newer than it, so the payout is the rank the site showed
      // at the time; `n` is those rows, itself included. Scores from before the event never count, not even to rank.
      tx`
        INSERT INTO candy_ledger (player_id, event_id, amount, kind, award_key, ref)
        SELECT ${playerId}::text, ${event}::text,
               GREATEST(1, (d.candy::int * d.pct + 50) / 100),
               'daily_best',
               'candy:' || ${event}::text || ':daily_best:' || ${playerId}::text || ':' || d.board_id || ':' || d.day,
               d.board_id || '#' || d.day || '#' || d.rank
        FROM (
          SELECT r.board_id, r.day, r.candy, r.rank,
                 CASE WHEN r.rank = 1 THEN 100
                      WHEN r.rank <= 3 THEN 75
                      WHEN r.rank <= 10 THEN 50
                      WHEN r.rank <= (r.n + 1) / 2 THEN 25
                      ELSE 5 END AS pct
          FROM (
            SELECT best.board_id, to_char(best.uk_day, 'YYYY-MM-DD') AS day, best.candy,
                   1 + count(x.id) FILTER (WHERE CASE WHEN best.sort = 'asc' THEN x.score < best.score ELSE x.score > best.score END) AS rank,
                   count(x.id) AS n
            FROM (
              SELECT DISTINCT ON (s.board_id, (s.created_at AT TIME ZONE 'Europe/London')::date)
                     s.id, s.board_id, s.score, s.created_at, b.sort, b.candy,
                     (s.created_at AT TIME ZONE 'Europe/London')::date AS uk_day
              FROM scores s JOIN boards b ON b.id = s.board_id
              WHERE s.player_id = ${playerId}
                AND b.game_slug IS NOT NULL AND b.candy > 0 AND char_length(b.id) <= 120
                AND s.created_at >= ${config.opensAt}::timestamptz AND s.created_at < ${config.closesAt}::timestamptz
              ORDER BY s.board_id, (s.created_at AT TIME ZONE 'Europe/London')::date,
                       CASE WHEN b.sort = 'asc' THEN s.score END ASC,
                       CASE WHEN b.sort <> 'asc' THEN s.score END DESC,
                       s.created_at ASC, s.id ASC
            ) best
            JOIN scores x ON x.board_id = best.board_id
                         AND x.created_at >= ${config.opensAt}::timestamptz AND x.created_at <= best.created_at
            GROUP BY best.id, best.board_id, best.uk_day, best.candy, best.sort, best.score
          ) r
        ) d
        ON CONFLICT (award_key) DO NOTHING
        RETURNING amount
      `,
      // The first accepted ranked run on each counting board.
      tx`
        INSERT INTO candy_ledger (player_id, event_id, amount, kind, award_key, ref)
        SELECT ${playerId}::text, ${event}::text, ${config.rankedRun}::int, 'ranked_run',
               'candy:' || ${event}::text || ':ranked_run:' || ${playerId}::text || ':' || b.game_slug, b.game_slug
        FROM (
          SELECT DISTINCT g.game_slug
          FROM championship_games g
          JOIN championship_runs r ON r.event_id = g.event_id AND r.game_slug = g.game_slug
          WHERE g.event_id = ${event} AND g.status IN ('open','paused') AND g.opened_at IS NOT NULL
            AND r.player_id = ${playerId} AND r.status = 'accepted'
        ) b
        ON CONFLICT (award_key) DO NOTHING
        RETURNING amount
      `,
      // A result on every board, from the FROZEN snapshot: the player's overall entry is `eligible`.
      tx`
        INSERT INTO candy_ledger (player_id, event_id, amount, kind, award_key, ref)
        SELECT ${playerId}::text, ${event}::text, ${config.allBoards}::int, 'all_boards',
               'candy:' || ${event}::text || ':all_boards:' || ${playerId}::text, NULL::text
        FROM championship_events ev
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(ev.final_standings->'overall') = 'array' THEN ev.final_standings->'overall' ELSE '[]'::jsonb END
        ) AS o(entry)
        WHERE ev.id = ${event} AND ev.status IN ('finalised','archived') AND ev.final_standings IS NOT NULL
          AND (o.entry->>'eligible') = 'true'
          AND (o.entry->>'publicId') = (SELECT p.public_id::text FROM players p WHERE p.id = ${playerId})
        LIMIT 1
        ON CONFLICT (award_key) DO NOTHING
        RETURNING amount
      `,
      // Placings, from the FROZEN snapshot, once the championship is finalised.
      tx`
        INSERT INTO candy_ledger (player_id, event_id, amount, kind, award_key, ref)
        SELECT ${playerId}::text, ${event}::text, t.amount,
               'placing',
               'candy:' || ${event}::text || ':placing:' || ${playerId}::text || ':' || (b.board->>'slug'),
               (b.board->>'slug') || '#' || (e.entry->>'rank')
        FROM championship_events ev
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(ev.final_standings->'boards') = 'array' THEN ev.final_standings->'boards' ELSE '[]'::jsonb END
        ) AS b(board)
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(b.board->'entries') = 'array' THEN b.board->'entries' ELSE '[]'::jsonb END
        ) AS e(entry)
        JOIN unnest(${tiers.from}::int[], ${tiers.to}::int[], ${tiers.amount}::int[]) AS t(lo, hi, amount)
          ON (e.entry->>'rank')::int BETWEEN t.lo AND t.hi
        WHERE ev.id = ${event} AND ev.status IN ('finalised','archived') AND ev.final_standings IS NOT NULL
          AND (b.board->>'counting') = 'true'
          AND (e.entry->>'publicId') = (SELECT p.public_id::text FROM players p WHERE p.id = ${playerId})
        ON CONFLICT (award_key) DO NOTHING
        RETURNING amount
      `,
    ]);
    let credited = 0;
    let amount = 0;
    for (const rows of results.slice(3)) {
      for (const r of (rows ?? []) as Row[]) {
        credited += 1;
        amount += num(r.amount);
      }
    }
    return { credited, amount };
  }

  /** The player's balance: credits minus spends, revoked credits excluded. May be negative after a revocation. */
  async function balance(playerId: string): Promise<number> {
    const rows = (await sql`
      SELECT COALESCE(sum(amount), 0)::int AS n
      FROM candy_ledger
      WHERE player_id = ${playerId} AND event_id = ${event} AND revoked_at IS NULL
    `) as Row[];
    return num(rows[0]?.n);
  }

  /** The player's ledger, newest first (revoked rows included, marked). */
  async function history(playerId: string, limit = 25): Promise<LedgerEntry[]> {
    const rows = (await sql`
      SELECT l.id, l.kind, l.amount, l.ref, l.created_at, l.revoked_at, b.game_slug
      FROM candy_ledger l
      LEFT JOIN boards b ON l.kind = 'daily_best' AND b.id = split_part(l.ref, '#', 1)
      WHERE l.player_id = ${playerId} AND l.event_id = ${event}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ${Math.max(1, Math.min(limit, 100))}
    `) as Row[];
    return rows.map((r) => ({
      id: num(r.id),
      kind: kindOf(r.kind),
      amount: num(r.amount),
      ref: str(r.ref),
      gameSlug: str(r.game_slug),
      createdAt: toIso(r.created_at)!,
      revoked: r.revoked_at != null,
    }));
  }

  /**
   * Buy one pack. Idempotent per `requestId`, atomic with the grant, and never
   * overspends.
   *
   * 1. A pack with no published price, or a malformed request id: refused before
   *    the database.
   * 2. ONE transaction: the player's advisory lock, then one statement that
   *    inserts the sealed pack only if the balance covers the price and the
   *    database clock is inside the spending window, and the debit linked to it.
   * 3. If it inserted nothing, either the request was already honoured (return
   *    that pack, `alreadySpent`) or it was refused (closed or insufficient).
   */
  async function spend(playerId: string, packId: string, requestId: string): Promise<SpendResult> {
    const def = getPack(packId);
    const price = Object.hasOwn(config.prices, packId) ? config.prices[packId] : undefined;
    if (!def || price === undefined) return { status: "bad-pack" };
    if (!REQUEST_ID_RE.test(requestId)) return { status: "bad-request" };
    const key = `candy:${event}:spend:${playerId}:${requestId}`;
    const version = currentVersion(def).v;

    const results = await sql.transaction((tx) => [
      tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(playerId)}, 0))`,
      tx`
        WITH bal AS (
          SELECT COALESCE(sum(amount), 0)::int AS n
          FROM candy_ledger
          WHERE player_id = ${playerId} AND event_id = ${event} AND revoked_at IS NULL
        ), pk AS (
          INSERT INTO player_packs (player_id, pack_id, pack_version, grant_key, source, source_ref)
          SELECT ${playerId}::text, ${packId}::text, ${version}::int, ${key}::text, 'event', ${"candy:" + event}::text
          FROM bal
          WHERE bal.n >= ${price}::int
            AND now() >= ${config.opensAt}::timestamptz AND now() < ${config.spendUntil}::timestamptz
          ON CONFLICT (grant_key) DO NOTHING
          RETURNING id, public_id
        ), debit AS (
          INSERT INTO candy_ledger (player_id, event_id, amount, kind, award_key, ref, player_pack_id)
          SELECT ${playerId}::text, ${event}::text, ${-price}::int, 'spend', ${key}::text, ${packId}::text, pk.id
          FROM pk
          ON CONFLICT (award_key) DO NOTHING
          RETURNING id
        )
        SELECT pk.public_id, (SELECT n FROM bal) - ${price}::int AS balance, (SELECT count(*)::int FROM debit) AS debited
        FROM pk
      `,
    ]);
    const bought = ((results[1] ?? []) as Row[])[0];
    if (bought) {
      return { status: "ok", alreadySpent: false, packPublicId: String(bought.public_id), packId, price, balance: num(bought.balance) };
    }

    // Nothing was inserted: a replay of an honoured request, or a refusal.
    const prior = (await sql`
      SELECT l.ref, pp.public_id
      FROM candy_ledger l JOIN player_packs pp ON pp.id = l.player_pack_id
      WHERE l.award_key = ${key} AND l.player_id = ${playerId}
    `) as Row[];
    if (prior[0]) {
      // The same request id for a different pack is a client bug, not a replay.
      if (String(prior[0].ref) !== packId) return { status: "bad-request" };
      return { status: "ok", alreadySpent: true, packPublicId: String(prior[0].public_id), packId, price, balance: await balance(playerId) };
    }
    const state = (await sql`
      SELECT (now() >= ${config.opensAt}::timestamptz) AS started, (now() < ${config.spendUntil}::timestamptz) AS open
    `) as Row[];
    if (state[0]?.started !== true) return { status: "closed", reason: "not-open-yet" };
    if (state[0]?.open !== true) return { status: "closed", reason: "expired" };
    return { status: "insufficient", balance: await balance(playerId), price };
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  /** Every board that belongs to a game, with its candy value and window activity, optionally for one game. */
  async function listBoards(slug?: string | null): Promise<AdminBoard[]> {
    const rows = (await sql`
      SELECT b.id, b.game_slug, b.title, b.sort, b.candy,
             COALESCE(w.scores, 0)::int AS scores, COALESCE(w.players, 0)::int AS players
      FROM boards b
      LEFT JOIN LATERAL (
        SELECT count(*) AS scores, count(DISTINCT s.player_id) AS players
        FROM scores s
        WHERE s.board_id = b.id AND s.player_id IS NOT NULL
          AND s.created_at >= ${config.opensAt}::timestamptz AND s.created_at < ${config.closesAt}::timestamptz
      ) w ON true
      WHERE b.game_slug IS NOT NULL AND (${slug ?? null}::text IS NULL OR b.game_slug = ${slug ?? null}::text)
      ORDER BY b.game_slug, b.title, b.id
      LIMIT 2000
    `) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      gameSlug: String(r.game_slug),
      title: String(r.title),
      sort: r.sort === "asc" ? "asc" : "desc",
      candy: num(r.candy),
      scoresInWindow: num(r.scores),
      playersInWindow: num(r.players),
    }));
  }

  /** The boards that pay (a game, `candy` above 0): public data, the payout per game. */
  async function payingBoards(): Promise<{ id: string; gameSlug: string; title: string; candy: number }[]> {
    const rows = (await sql`
      SELECT id, game_slug, title, candy FROM boards
      WHERE game_slug IS NOT NULL AND candy > 0
      ORDER BY candy DESC, game_slug, id
      LIMIT 500
    `) as Row[];
    return rows.map((r) => ({ id: String(r.id), gameSlug: String(r.game_slug), title: String(r.title), candy: num(r.candy) }));
  }

  /**
   * Set a board's candy value (0 to the ceiling), logged in the same statement.
   * Credits already made are never re-priced; the next sync pays earlier days in
   * the window at the NEW value, only where the player has no credit yet.
   */
  async function setBoardCandy(input: { boardId: string; candy: number; actorEmail: string }): Promise<SetValueResult> {
    if (!isGameCandy(config, input.candy)) throw new Error(`Candy must be a whole number from 0 to ${config.maxGameCandy}`);
    if (!BOARD_ID_RE.test(input.boardId) || input.boardId.length > 120) throw new Error("Invalid board id");
    const rows = (await sql`
      WITH old AS (
        SELECT id, game_slug, candy FROM boards WHERE id = ${input.boardId} AND game_slug IS NOT NULL
      ), upd AS (
        UPDATE boards b SET candy = ${input.candy}::smallint, updated_at = now()
        FROM old
        WHERE b.id = old.id AND old.candy <> ${input.candy}::int
        RETURNING b.id
      ), log AS (
        INSERT INTO candy_log (actor_email, action, data)
        SELECT ${input.actorEmail}, 'set-value',
               json_build_object('boardId', old.id, 'slug', old.game_slug, 'from', old.candy, 'to', ${input.candy}::int)::jsonb
        FROM old JOIN upd ON upd.id = old.id
        RETURNING id
      )
      SELECT (SELECT count(*)::int FROM old) AS found, (SELECT count(*)::int FROM upd) AS changed, (SELECT count(*)::int FROM log) AS logged
    `) as Row[];
    if (num(rows[0]?.found) === 0) return "not-found";
    return num(rows[0]?.changed) > 0 ? "changed" : "unchanged";
  }

  /**
   * Revoke one credit (it stops counting), with a reason, logged in the same
   * statement. A spend cannot be revoked. Takes the player's lock first, like a
   * spend, so the balance it lowers is never half-read. `false` when there was
   * nothing to revoke (no such row, a spend, or already revoked).
   */
  async function revokeCredit(input: { ledgerId: number; actorEmail: string; reason: string }): Promise<boolean> {
    const reason = cleanReason(input.reason);
    if (!Number.isSafeInteger(input.ledgerId) || input.ledgerId <= 0) return false;
    const results = await sql.transaction((tx) => [
      tx`SELECT pg_advisory_xact_lock(hashtextextended('candy:' || l.player_id, 0)) FROM candy_ledger l WHERE l.id = ${input.ledgerId}`,
      tx`
        WITH rev AS (
          UPDATE candy_ledger
          SET revoked_at = now(), revoked_by = ${input.actorEmail}, revoked_reason = ${reason}
          WHERE id = ${input.ledgerId} AND kind <> 'spend' AND revoked_at IS NULL
          RETURNING id, player_id, kind, amount, ref
        ), log AS (
          INSERT INTO candy_log (actor_email, action, player_id, ledger_id, reason, data)
          SELECT ${input.actorEmail}, 'revoke-credit', rev.player_id, rev.id, ${reason},
                 json_build_object('kind', rev.kind, 'amount', rev.amount, 'ref', rev.ref)::jsonb
          FROM rev
          RETURNING id
        )
        SELECT id FROM rev
      `,
    ]);
    return ((results[1] ?? []) as Row[]).length > 0;
  }

  /** The newest ledger rows across all players, with PUBLIC names only. */
  async function listRecent(limit = 50, publicId: string | null = null): Promise<AdminLedgerRow[]> {
    const rows = (await sql`
      SELECT l.id, l.kind, l.amount, l.ref, l.created_at, l.revoked_at, l.revoked_by, l.revoked_reason, bd.game_slug,
             p.public_id AS p_public_id, p.handle AS p_handle, p.username AS p_username
      FROM candy_ledger l JOIN players p ON p.id = l.player_id
      LEFT JOIN boards bd ON l.kind = 'daily_best' AND bd.id = split_part(l.ref, '#', 1)
      WHERE l.event_id = ${event} AND (${publicId}::text IS NULL OR p.public_id::text = ${publicId}::text)
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ${Math.max(1, Math.min(limit, 200))}
    `) as Row[];
    return rows.map((r) => {
      const publicId = String(r.p_public_id);
      return {
        id: num(r.id),
        kind: kindOf(r.kind),
        amount: num(r.amount),
        ref: str(r.ref),
        gameSlug: str(r.game_slug),
        createdAt: toIso(r.created_at)!,
        revokedAt: toIso(r.revoked_at),
        revokedBy: str(r.revoked_by),
        revokedReason: str(r.revoked_reason),
        player: { publicId, name: publicScoreName({ handle: str(r.p_handle), username: str(r.p_username), publicId }) },
      };
    });
  }

  /**
   * Players by unrevoked credited candy, biggest first, with PUBLIC names only.
   * Scores are self-submitted, so this is where a forger shows up: a high
   * daily-best total with rank 1 on many boards.
   */
  async function topEarners(limit = 25): Promise<TopEarner[]> {
    const rows = (await sql`
      WITH t AS (
        SELECT player_id,
               COALESCE(sum(amount) FILTER (WHERE amount > 0 AND revoked_at IS NULL), 0)::int AS credited,
               COALESCE(sum(amount) FILTER (WHERE kind = 'daily_best' AND revoked_at IS NULL), 0)::int AS daily_best_total,
               count(*) FILTER (WHERE kind = 'daily_best' AND revoked_at IS NULL)::int AS daily_best_count,
               min(CASE WHEN kind = 'daily_best' AND revoked_at IS NULL THEN split_part(ref, '#', 3)::int END) AS best_rank,
               COALESCE(-sum(amount) FILTER (WHERE amount < 0), 0)::int AS spent,
               COALESCE(sum(amount) FILTER (WHERE revoked_at IS NULL), 0)::int AS balance
        FROM candy_ledger WHERE event_id = ${event}
        GROUP BY player_id
      )
      SELECT t.*, p.public_id AS p_public_id, p.handle AS p_handle, p.username AS p_username
      FROM t JOIN players p ON p.id = t.player_id
      ORDER BY t.credited DESC, t.player_id
      LIMIT ${Math.max(1, Math.min(limit, 100))}
    `) as Row[];
    return rows.map((r) => {
      const publicId = String(r.p_public_id);
      return {
        player: { publicId, name: publicScoreName({ handle: str(r.p_handle), username: str(r.p_username), publicId }) },
        credited: num(r.credited),
        dailyBestTotal: num(r.daily_best_total),
        dailyBestCount: num(r.daily_best_count),
        bestRank: r.best_rank == null ? null : num(r.best_rank),
        spent: num(r.spent),
        balance: num(r.balance),
      };
    });
  }

  /** Totals for the dashboard header. */
  async function stats(): Promise<CandyStats> {
    const rows = (await sql`
      SELECT count(DISTINCT player_id) FILTER (WHERE kind <> 'spend')::int AS players,
             COALESCE(sum(amount) FILTER (WHERE amount > 0 AND revoked_at IS NULL), 0)::int AS credited,
             COALESCE(-sum(amount) FILTER (WHERE amount < 0), 0)::int AS spent,
             COALESCE(sum(amount) FILTER (WHERE amount > 0 AND revoked_at IS NOT NULL), 0)::int AS revoked
      FROM candy_ledger WHERE event_id = ${event}
    `) as Row[];
    const r = rows[0] ?? {};
    return { players: num(r.players), credited: num(r.credited), spent: num(r.spent), revoked: num(r.revoked) };
  }

  /** The admin audit log, newest first, naming players by their PUBLIC name only. */
  async function readLog(limit = 100): Promise<CandyLogEntry[]> {
    const rows = (await sql`
      SELECT l.id, l.actor_email, l.action, l.reason, l.data, l.created_at,
             p.public_id AS p_public_id, p.handle AS p_handle, p.username AS p_username
      FROM candy_log l LEFT JOIN players p ON p.id = l.player_id
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ${Math.max(1, Math.min(limit, 500))}
    `) as Row[];
    return rows.map((r) => {
      const publicId = r.p_public_id == null ? null : String(r.p_public_id);
      return {
        id: num(r.id),
        actorEmail: String(r.actor_email),
        action: String(r.action),
        publicId,
        name: publicId ? publicScoreName({ handle: str(r.p_handle), username: str(r.p_username), publicId }) : null,
        reason: str(r.reason),
        data: r.data ?? null,
        createdAt: toIso(r.created_at)!,
      };
    });
  }

  return { sync, balance, history, spend, listBoards, payingBoards, setBoardCandy, revokeCredit, listRecent, topEarners, stats, readLog };
}

export type CandyStore = ReturnType<typeof createCandyStore>;
