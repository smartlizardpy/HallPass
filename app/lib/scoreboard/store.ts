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
}

/** Result of `appendScore`: the accepted rank, or a rate-limit rejection. */
export type AppendScoreResult =
  | { ok: true; rank: number }
  | { ok: false; reason: "rate-limited" };

function mapBoard(row: Row): BoardConfig {
  return {
    slug: String(row.slug),
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
   * Idempotent board provisioning. `ON CONFLICT (slug) DO UPDATE` upserts, and
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
      INSERT INTO boards (slug, title, sort, score_label, max_score)
      VALUES (${input.slug}, ${input.title}, ${sort}, ${scoreLabel}, ${maxScore})
      ON CONFLICT (slug) DO UPDATE SET
        title = EXCLUDED.title,
        sort = EXCLUDED.sort,
        score_label = EXCLUDED.score_label,
        max_score = EXCLUDED.max_score,
        updated_at = now()
      RETURNING slug, title, sort, score_label, max_score, (xmax = 0) AS created
    `;
    const row = rows[0];
    return { board: mapBoard(row), created: row.created === true };
  }

  async function getBoard(slug: string): Promise<BoardConfig | null> {
    const rows = await sql`
      SELECT slug, title, sort, score_label, max_score
      FROM boards
      WHERE slug = ${slug}
    `;
    return rows.length > 0 ? mapBoard(rows[0]) : null;
  }

  async function boardExists(slug: string): Promise<boolean> {
    const rows = await sql`SELECT 1 FROM boards WHERE slug = ${slug}`;
    return rows.length > 0;
  }

  async function listBoards(): Promise<BoardConfig[]> {
    const rows = await sql`
      SELECT slug, title, sort, score_label, max_score
      FROM boards
      ORDER BY created_at ASC, slug ASC
    `;
    return rows.map(mapBoard);
  }

  /**
   * Top `limit` rows for a board. The branch is on whitelisted enums only — six
   * fully-written templates (sort × period) — never an interpolated fragment.
   * Rank is positional (1..N), matching the index-ordered scan.
   */
  async function getTopScores(
    slug: string,
    { limit, period, sort }: TopScoresOptions,
  ): Promise<ScoreEntry[]> {
    const rows = await selectTopRows(slug, limit, period, sort);
    return rows.map((row, index) => ({
      rank: index + 1,
      handle: String(row.handle),
      score: Number(row.score),
    }));
  }

  function selectTopRows(slug: string, limit: number, period: Period, sort: SortDir) {
    if (sort === "asc") {
      if (period === "day") {
        return sql`
          SELECT handle, score FROM scores
          WHERE slug = ${slug} AND created_at >= now() - make_interval(0, 0, 0, 1)
          ORDER BY score ASC, created_at ASC, id ASC
          LIMIT ${limit}
        `;
      }
      if (period === "week") {
        return sql`
          SELECT handle, score FROM scores
          WHERE slug = ${slug} AND created_at >= now() - make_interval(0, 0, 1)
          ORDER BY score ASC, created_at ASC, id ASC
          LIMIT ${limit}
        `;
      }
      return sql`
        SELECT handle, score FROM scores
        WHERE slug = ${slug}
        ORDER BY score ASC, created_at ASC, id ASC
        LIMIT ${limit}
      `;
    }
    // sort === "desc"
    if (period === "day") {
      return sql`
        SELECT handle, score FROM scores
        WHERE slug = ${slug} AND created_at >= now() - make_interval(0, 0, 0, 1)
        ORDER BY score DESC, created_at ASC, id ASC
        LIMIT ${limit}
      `;
    }
    if (period === "week") {
      return sql`
        SELECT handle, score FROM scores
        WHERE slug = ${slug} AND created_at >= now() - make_interval(0, 0, 1)
        ORDER BY score DESC, created_at ASC, id ASC
        LIMIT ${limit}
      `;
    }
    return sql`
      SELECT handle, score FROM scores
      WHERE slug = ${slug}
      ORDER BY score DESC, created_at ASC, id ASC
      LIMIT ${limit}
    `;
  }

  /**
   * Competition rank a `score` would earn on `slug`: `1 + strictly-better`.
   * "Better" flips with `sort` (greater for desc, smaller for asc). The
   * `count(*)::int` cast returns a JS number directly.
   */
  async function rankForScore(slug: string, score: number, sort: SortDir): Promise<number> {
    const rows =
      sort === "asc"
        ? await sql`
            SELECT count(*)::int AS better FROM scores
            WHERE slug = ${slug} AND score < ${score}
          `
        : await sql`
            SELECT count(*)::int AS better FROM scores
            WHERE slug = ${slug} AND score > ${score}
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
    slug: string,
    { handle, score, ipHash }: AppendScoreInput,
    sort: SortDir,
    limit: RateLimit = DEFAULT_RATE_LIMIT,
  ): Promise<AppendScoreResult> {
    const { maxPerWindow, windowSeconds } = limit;
    const rows =
      sort === "asc"
        ? await sql`
            WITH recent AS (
              SELECT count(*) AS n FROM scores
              WHERE slug = ${slug} AND ip_hash = ${ipHash}
                AND created_at >= now() - make_interval(0, 0, 0, 0, 0, 0, ${windowSeconds})
            ),
            ins AS (
              INSERT INTO scores (slug, handle, score, ip_hash)
              SELECT ${slug}, ${handle}, ${score}, ${ipHash}
              WHERE (SELECT n FROM recent) < ${maxPerWindow}
              RETURNING id
            )
            SELECT (
              SELECT count(*) FROM scores
              WHERE slug = ${slug} AND score < ${score}
            ) + 1 AS rank
            FROM ins
          `
        : await sql`
            WITH recent AS (
              SELECT count(*) AS n FROM scores
              WHERE slug = ${slug} AND ip_hash = ${ipHash}
                AND created_at >= now() - make_interval(0, 0, 0, 0, 0, 0, ${windowSeconds})
            ),
            ins AS (
              INSERT INTO scores (slug, handle, score, ip_hash)
              SELECT ${slug}, ${handle}, ${score}, ${ipHash}
              WHERE (SELECT n FROM recent) < ${maxPerWindow}
              RETURNING id
            )
            SELECT (
              SELECT count(*) FROM scores
              WHERE slug = ${slug} AND score > ${score}
            ) + 1 AS rank
            FROM ins
          `;
    if (rows.length === 0) {
      return { ok: false, reason: "rate-limited" };
    }
    return { ok: true, rank: Number(rows[0].rank) };
  }

  return {
    createBoard,
    getBoard,
    boardExists,
    getTopScores,
    rankForScore,
    appendScore,
    listBoards,
  };
}

/** The store shape, for callers that want to type a wired instance. */
export type ScoreboardStore = ReturnType<typeof createStore>;
