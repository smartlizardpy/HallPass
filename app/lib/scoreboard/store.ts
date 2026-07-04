/**
 * HallPass Scoreboard — data-access layer over Neon.
 *
 * Exposed as a FACTORY, `createStore(sql)`, rather than a module that reaches
 * for a global connection. That single seam is what makes every query unit
 * testable: tests pass a fake tagged-template function that records calls and
 * returns canned rows, while `index.ts` wires the real `neon()` function from
 * `db.ts`. This module imports the driver's TYPE only, so it pulls no runtime
 * dependency on the database and can run in a plain Node test environment.
 *
 * SQL safety — the load-bearing rule of this file:
 *   The `neon()` tagged template parameterises interpolated VALUES; it does NOT
 *   reliably splice raw SQL fragments. So we NEVER interpolate a fragment
 *   variable (no dynamic `ORDER BY`/interval strings). Instead we branch in JS
 *   on the already-whitelisted `sort`/`period` enums into explicit,
 *   fully-written query templates, and only ever interpolate bound values
 *   (`slug`, `score`, `handle`, `limit`, window size, ...).
 *
 * BIGINT note: Postgres `int8`/`bigint` columns (`score`, `max_score`, and any
 * `count(*)`) come back from the driver as STRINGS to avoid precision loss, so
 * every numeric egress is funnelled through `Number(...)`.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import type {
  BoardConfig,
  CreateBoardRequest,
  Period,
  ScoreEntry,
  SortDir,
} from "@/sdk/src/contract";
import { DEFAULT_RATE_LIMIT, type RateLimit } from "./config";

/** The subset of the Neon query function the store needs: callable as a tag. */
type Sql = NeonQueryFunction<false, false>;

/** A row as returned by the driver (column names as keys). */
type Row = Record<string, unknown>;

/** Options for a single leaderboard page. */
export interface TopScoresOptions {
  limit: number;
  period: Period;
  sort: SortDir;
}

/** A score about to be written. `ipHash` is null only when un-hashable. */
export interface AppendScoreInput {
  handle: string;
  score: number;
  ipHash: string | null;
  /**
   * The verified player's Google subject id (`players.id`) when the submission
   * carried a session, else `null`/absent for an anonymous submission. Stored on
   * `scores.player_id` (FK, ON DELETE SET NULL) so a leaderboard read can tag the
   * row as verified and join the player's avatar/effective display.
   */
  playerId?: string | null;
}

/** Result of `appendScore`: the accepted row `id` + rank, or a rate-limit rejection. */
export type AppendScoreResult =
  | { ok: true; id: number; rank: number }
  | { ok: false; reason: "rate-limited" };

/**
 * A single score row surfaced to the moderation UI. Unlike the public
 * `ScoreEntry` (rank + handle + score), moderation needs the raw row `id` (to
 * target a delete) and the `createdAt` timestamp (newest-first ordering), but
 * never the IP hash — that stays server-side. `score` is funnelled through
 * `Number(...)` like every BIGINT egress.
 */
export interface ModerationScore {
  id: number;
  handle: string;
  score: number;
  createdAt: string;
}

/**
 * One row of a player's cross-board standings: for every board the player has a
 * score on, their personal best and the competition rank that best earns. `best`
 * is the min (asc boards) or max (desc boards) of their own scores; `rank` is
 * `1 + strictly-better` rows on that board, matching `rankForScore` semantics.
 * `best` and `rank` are BIGINT/count egress, so both funnel through `Number(...)`;
 * `gameSlug` is null-safe (a board need not be linked to a game).
 */
export interface PlayerStanding {
  boardId: string;
  title: string;
  gameSlug: string | null;
  sort: SortDir;
  best: number;
  rank: number;
}

function mapBoard(row: Row): BoardConfig {
  return {
    slug: String(row.id),
    gameSlug: row.game_slug == null ? null : String(row.game_slug),
    title: String(row.title),
    sort: row.sort === "asc" ? "asc" : "desc",
    scoreLabel: String(row.score_label),
    maxScore:
      row.max_score === null || row.max_score === undefined
        ? null
        : Number(row.max_score),
  };
}

/**
 * Build a store bound to a specific `sql` query function. The real wiring lives
 * in `index.ts` (`createStore(sql)` from `db.ts`); tests pass a fake `sql`.
 */
export function createStore(sql: Sql) {
  /**
   * Idempotent board provisioning. `ON CONFLICT (id) DO UPDATE` upserts, and
   * `(xmax = 0) AS created` is the canonical Postgres trick for "was this row
   * freshly inserted?" — `xmax` is 0 on an INSERT and non-zero on an UPDATE.
   */
  async function createBoard(
    input: CreateBoardRequest,
  ): Promise<{ board: BoardConfig; created: boolean }> {
    const sort: SortDir = input.sort === "asc" ? "asc" : "desc";
    const scoreLabel = input.scoreLabel?.trim() || "Score";
    const maxScore = input.maxScore ?? null;
    const rows = await sql`
      INSERT INTO boards (id, game_slug, title, sort, score_label, max_score)
      VALUES (${input.slug}, ${input.gameSlug ?? null}, ${input.title}, ${sort}, ${scoreLabel}, ${maxScore})
      ON CONFLICT (id) DO UPDATE SET
        game_slug = EXCLUDED.game_slug,
        title = EXCLUDED.title,
        sort = EXCLUDED.sort,
        score_label = EXCLUDED.score_label,
        max_score = EXCLUDED.max_score,
        updated_at = now()
      RETURNING id, game_slug, title, sort, score_label, max_score, (xmax = 0) AS created
    `;
    const row = rows[0];
    return { board: mapBoard(row), created: row.created === true };
  }

  async function getBoard(boardId: string): Promise<BoardConfig | null> {
    const rows = await sql`
      SELECT id, game_slug, title, sort, score_label, max_score
      FROM boards
      WHERE id = ${boardId}
    `;
    return rows.length > 0 ? mapBoard(rows[0]) : null;
  }

  async function boardExists(boardId: string): Promise<boolean> {
    const rows = await sql`SELECT 1 FROM boards WHERE id = ${boardId}`;
    return rows.length > 0;
  }

  async function listBoards(): Promise<BoardConfig[]> {
    const rows = await sql`
      SELECT id, game_slug, title, sort, score_label, max_score
      FROM boards
      ORDER BY created_at ASC, id ASC
    `;
    return rows.map(mapBoard);
  }

  /**
   * Top `limit` rows for a board. The branch is on whitelisted enums only — six
   * fully-written templates (sort × period) — never an interpolated fragment.
   * Rank is positional (1..N), matching the index-ordered scan.
   *
   * Each branch LEFT JOINs `players` so a verified row (`scores.player_id` set)
   * is tagged in its `ScoreEntry`: `verified = true`, `handle` becomes the
   * player's effective display (chosen `p_handle`, else Google `p_name`, else the
   * stored `scores.handle`), and `avatar` carries `players.image`. An anonymous
   * row (no `player_id`) maps to `verified = false` with the stored handle and no
   * avatar. EMAIL is never selected here.
   */
  async function getTopScores(
    boardId: string,
    { limit, period, sort }: TopScoresOptions,
  ): Promise<ScoreEntry[]> {
    const rows = await selectTopRows(boardId, limit, period, sort);
    return rows.map((row, index) => {
      const rank = index + 1;
      if (row.player_id != null) {
        const pHandle = typeof row.p_handle === "string" ? row.p_handle.trim() : "";
        const pName = typeof row.p_name === "string" ? row.p_name.trim() : "";
        return {
          rank,
          handle: pHandle || pName || String(row.handle),
          score: Number(row.score),
          verified: true,
          avatar: row.p_image == null ? null : String(row.p_image),
        };
      }
      return {
        rank,
        handle: String(row.handle),
        score: Number(row.score),
        verified: false,
      };
    });
  }

  /**
   * The six whitelisted SELECT templates (sort × period) behind `getTopScores`.
   * Each LEFT JOINs `players p ON p.id = s.player_id` to carry the verified
   * player's `handle`/`name`/`image` alongside the raw `scores` row; an anonymous
   * row simply yields NULL for the `p_*` columns. Columns that exist on BOTH
   * tables (`handle`, `created_at`, `id`) are table-qualified to avoid ambiguity;
   * `score` lives only on `scores`, so it stays unqualified and the index-ordered
   * `ORDER BY score DESC|ASC` resolves to `s.score`. Only `boardId` and `limit`
   * are ever bound — the join introduces no spliced fragment.
   */
  function selectTopRows(boardId: string, limit: number, period: Period, sort: SortDir) {
    if (sort === "asc") {
      if (period === "day") {
        return sql`
          SELECT s.handle, s.score, s.player_id, p.handle AS p_handle, p.name AS p_name, p.image AS p_image
          FROM scores s LEFT JOIN players p ON p.id = s.player_id
          WHERE s.board_id = ${boardId} AND s.created_at >= now() - make_interval(0, 0, 0, 1)
          ORDER BY score ASC, s.created_at ASC, s.id ASC
          LIMIT ${limit}
        `;
      }
      if (period === "week") {
        return sql`
          SELECT s.handle, s.score, s.player_id, p.handle AS p_handle, p.name AS p_name, p.image AS p_image
          FROM scores s LEFT JOIN players p ON p.id = s.player_id
          WHERE s.board_id = ${boardId} AND s.created_at >= now() - make_interval(0, 0, 1)
          ORDER BY score ASC, s.created_at ASC, s.id ASC
          LIMIT ${limit}
        `;
      }
      return sql`
        SELECT s.handle, s.score, s.player_id, p.handle AS p_handle, p.name AS p_name, p.image AS p_image
        FROM scores s LEFT JOIN players p ON p.id = s.player_id
        WHERE s.board_id = ${boardId}
        ORDER BY score ASC, s.created_at ASC, s.id ASC
        LIMIT ${limit}
      `;
    }
    // sort === "desc"
    if (period === "day") {
      return sql`
        SELECT s.handle, s.score, s.player_id, p.handle AS p_handle, p.name AS p_name, p.image AS p_image
        FROM scores s LEFT JOIN players p ON p.id = s.player_id
        WHERE s.board_id = ${boardId} AND s.created_at >= now() - make_interval(0, 0, 0, 1)
        ORDER BY score DESC, s.created_at ASC, s.id ASC
        LIMIT ${limit}
      `;
    }
    if (period === "week") {
      return sql`
        SELECT s.handle, s.score, s.player_id, p.handle AS p_handle, p.name AS p_name, p.image AS p_image
        FROM scores s LEFT JOIN players p ON p.id = s.player_id
        WHERE s.board_id = ${boardId} AND s.created_at >= now() - make_interval(0, 0, 1)
        ORDER BY score DESC, s.created_at ASC, s.id ASC
        LIMIT ${limit}
      `;
    }
    return sql`
      SELECT s.handle, s.score, s.player_id, p.handle AS p_handle, p.name AS p_name, p.image AS p_image
      FROM scores s LEFT JOIN players p ON p.id = s.player_id
      WHERE s.board_id = ${boardId}
      ORDER BY score DESC, s.created_at ASC, s.id ASC
      LIMIT ${limit}
    `;
  }

  /**
   * Competition rank a `score` would earn on `boardId`: `1 + strictly-better`.
   * "Better" flips with `sort` (greater for desc, smaller for asc). The
   * `count(*)::int` cast returns a JS number directly.
   */
  async function rankForScore(boardId: string, score: number, sort: SortDir): Promise<number> {
    const rows =
      sort === "asc"
        ? await sql`
            SELECT count(*)::int AS better FROM scores
            WHERE board_id = ${boardId} AND score < ${score}
          `
        : await sql`
            SELECT count(*)::int AS better FROM scores
            WHERE board_id = ${boardId} AND score > ${score}
          `;
    return Number(rows[0]?.better ?? 0) + 1;
  }

  /**
   * Insert a score under a per-IP sliding-window cap, in ONE statement:
   *  - `recent` counts this IP's writes inside the window,
   *  - `ins` performs the INSERT only when that count is under the cap,
   *  - the final SELECT (driven `FROM ins`) reports the new competition rank.
   * If the cap is hit, `ins` inserts nothing, the final SELECT yields zero rows,
   * and we resolve `{ ok:false, reason:"rate-limited" }`. The rank counts
   * strictly-better PRE-EXISTING rows (a data-modifying CTE's own insert is not
   * visible to sibling reads), which is exactly the competition rank.
   *
   * The cap is BEST-EFFORT under concurrency: two simultaneous requests can each
   * read `recent.n < cap` and both insert. That is an acceptable tradeoff for a
   * casual anti-flood limiter (no row lock / serializable transaction needed).
   */
  async function appendScore(
    boardId: string,
    { handle, score, ipHash, playerId }: AppendScoreInput,
    sort: SortDir,
    limit: RateLimit = DEFAULT_RATE_LIMIT,
  ): Promise<AppendScoreResult> {
    const { maxPerWindow, windowSeconds } = limit;
    const player = playerId ?? null;
    const rows =
      sort === "asc"
        ? await sql`
            WITH recent AS (
              SELECT count(*) AS n FROM scores
              WHERE board_id = ${boardId} AND ip_hash = ${ipHash}
                AND created_at >= now() - make_interval(0, 0, 0, 0, 0, 0, ${windowSeconds})
            ),
            ins AS (
              INSERT INTO scores (board_id, handle, score, ip_hash, player_id)
              SELECT ${boardId}, ${handle}, ${score}, ${ipHash}, ${player}
              WHERE (SELECT n FROM recent) < ${maxPerWindow}
              RETURNING id
            )
            SELECT ins.id AS id, (
              SELECT count(*) FROM scores
              WHERE board_id = ${boardId} AND score < ${score}
            ) + 1 AS rank
            FROM ins
          `
        : await sql`
            WITH recent AS (
              SELECT count(*) AS n FROM scores
              WHERE board_id = ${boardId} AND ip_hash = ${ipHash}
                AND created_at >= now() - make_interval(0, 0, 0, 0, 0, 0, ${windowSeconds})
            ),
            ins AS (
              INSERT INTO scores (board_id, handle, score, ip_hash, player_id)
              SELECT ${boardId}, ${handle}, ${score}, ${ipHash}, ${player}
              WHERE (SELECT n FROM recent) < ${maxPerWindow}
              RETURNING id
            )
            SELECT ins.id AS id, (
              SELECT count(*) FROM scores
              WHERE board_id = ${boardId} AND score > ${score}
            ) + 1 AS rank
            FROM ins
          `;
    if (rows.length === 0) {
      return { ok: false, reason: "rate-limited" };
    }
    return { ok: true, id: Number(rows[0].id), rank: Number(rows[0].rank) };
  }

  /**
   * Attach previously-anonymous scores to a now-verified player, in ONE
   * statement, and report how many rows were claimed. The `upd` CTE performs the
   * UPDATE and the outer `count(*)::int` tallies its `RETURNING` rows. The
   * `player_id IS NULL` guard makes this ONE-SHOT: an already-owned row (whether
   * this player's or another's) is skipped, so a token can never re-claim or
   * steal a score. `scores.handle` is left untouched. Both `playerId` and the
   * `scoreIds` array are bound; `scoreIds` is cast to `bigint[]` so the driver's
   * untyped array literal resolves against the BIGINT `id` column. An empty
   * `scoreIds` early-returns 0 to avoid binding an empty array.
   */
  async function claimScores(playerId: string, scoreIds: number[]): Promise<number> {
    if (scoreIds.length === 0) {
      return 0;
    }
    const rows = await sql`
      WITH upd AS (
        UPDATE scores SET player_id = ${playerId}
        WHERE id = ANY(${scoreIds}::bigint[]) AND player_id IS NULL
        RETURNING id
      )
      SELECT count(*)::int AS n FROM upd
    `;
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Total number of scores recorded on `boardId`. The `count(*)::int` cast
   * returns a JS number directly (no BIGINT-as-string egress to coerce).
   */
  async function countScores(boardId: string): Promise<number> {
    const rows = await sql`
      SELECT count(*)::int AS n FROM scores WHERE board_id = ${boardId}
    `;
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Newest-first page of raw score rows for the moderation table. Both `boardId`
   * and `limit` are BOUND values — no fragment is ever spliced. BIGINT `id` and
   * `score` egress through `Number(...)`; `created_at` is stringified as-is.
   */
  async function listScoresForModeration(
    boardId: string,
    limit: number,
  ): Promise<ModerationScore[]> {
    const rows = await sql`
      SELECT id, handle, score, created_at FROM scores
      WHERE board_id = ${boardId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: Number(row.id),
      handle: String(row.handle),
      score: Number(row.score),
      createdAt: String(row.created_at),
    }));
  }

  /**
   * Delete a single score by row `id`, SCOPED to `boardId` so a moderator of one
   * board can never delete another board's row by guessing an id. Both values
   * are bound. `RETURNING id` lets us report whether a row actually matched.
   */
  async function deleteScore(boardId: string, scoreId: number): Promise<boolean> {
    const rows = await sql`
      DELETE FROM scores
      WHERE id = ${scoreId} AND board_id = ${boardId}
      RETURNING id
    `;
    return rows.length > 0;
  }

  /**
   * Wipe every score on a board and report how many rows were removed, in ONE
   * statement. A data-modifying CTE (`del`) performs the DELETE and the outer
   * `count(*)::int` tallies its `RETURNING` rows atomically — no race between a
   * separate count and delete. `boardId` is bound.
   */
  async function clearBoardScores(boardId: string): Promise<number> {
    const rows = await sql`
      WITH del AS (
        DELETE FROM scores WHERE board_id = ${boardId} RETURNING id
      )
      SELECT count(*)::int AS n FROM del
    `;
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Permanently delete a board AND, via the `scores.board_id` FK (ON DELETE
   * CASCADE), every score submitted to it. Returns true when a row was removed,
   * false when `boardId` named no board. `boardId` is bound.
   */
  async function deleteBoard(boardId: string): Promise<boolean> {
    const rows = await sql`DELETE FROM boards WHERE id = ${boardId} RETURNING id`;
    return rows.length > 0;
  }

  /**
   * Every board currently linked to `gameSlug`, oldest-first (the same stable
   * `created_at ASC, id ASC` ordering as `listBoards`). `gameSlug` is the only
   * bound value; rows map through the shared `mapBoard`.
   */
  async function listBoardsForGame(gameSlug: string): Promise<BoardConfig[]> {
    const rows = await sql`
      SELECT id, game_slug, title, sort, score_label, max_score
      FROM boards
      WHERE game_slug = ${gameSlug}
      ORDER BY created_at ASC, id ASC
    `;
    return rows.map(mapBoard);
  }

  /**
   * Point a board at a game (or clear the link with `null`), bumping `updated_at`.
   * Both `gameSlug` and `boardId` are bound. `RETURNING id` lets us report whether
   * a board actually matched (false when `boardId` named no board).
   */
  async function setBoardGame(boardId: string, gameSlug: string | null): Promise<boolean> {
    const rows = await sql`
      UPDATE boards SET game_slug = ${gameSlug}, updated_at = now()
      WHERE id = ${boardId}
      RETURNING id
    `;
    return rows.length > 0;
  }

  /**
   * A player's standing on every board they've scored on, in ONE query. The
   * `mine` CTE collapses the player's own rows to their personal `best` per board
   * (min for asc boards, max for desc), then the outer SELECT computes each
   * board's competition rank as `1 + strictly-better` PRE-EXISTING rows — the same
   * semantics as `rankForScore` (greater is better on desc, smaller on asc). Only
   * `playerId` is bound; the `asc`/`desc` branch lives entirely inside whitelisted
   * `CASE` expressions on the stored `sort`, so no fragment is ever spliced.
   * `best` and `rank` egress through `Number(...)`; `gameSlug` is null-safe.
   */
  async function getPlayerStandings(playerId: string): Promise<PlayerStanding[]> {
    const rows = await sql`
      WITH mine AS (
        SELECT b.id AS board_id, b.title, b.game_slug, b.sort,
          CASE WHEN b.sort = 'asc' THEN min(s.score) ELSE max(s.score) END AS best
        FROM scores s JOIN boards b ON b.id = s.board_id
        WHERE s.player_id = ${playerId}
        GROUP BY b.id, b.title, b.game_slug, b.sort
      )
      SELECT m.board_id, m.title, m.game_slug, m.sort, m.best,
        1 + (SELECT count(*) FROM scores x WHERE x.board_id = m.board_id
               AND (CASE WHEN m.sort = 'asc' THEN x.score < m.best ELSE x.score > m.best END)) AS rank
      FROM mine m ORDER BY m.title ASC
    `;
    return rows.map((row) => ({
      boardId: String(row.board_id),
      title: String(row.title),
      gameSlug: row.game_slug == null ? null : String(row.game_slug),
      sort: row.sort === "asc" ? "asc" : "desc",
      best: Number(row.best),
      rank: Number(row.rank),
    }));
  }

  return {
    createBoard,
    getBoard,
    boardExists,
    getTopScores,
    rankForScore,
    appendScore,
    claimScores,
    listBoards,
    countScores,
    listScoresForModeration,
    deleteScore,
    clearBoardScores,
    deleteBoard,
    listBoardsForGame,
    setBoardGame,
    getPlayerStandings,
  };
}

/** The store shape, for callers that want to type a wired instance. */
export type ScoreboardStore = ReturnType<typeof createStore>;
