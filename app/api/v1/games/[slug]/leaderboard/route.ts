/**
 * A GAME's leaderboards — `GET|OPTIONS /api/v1/games/[slug]/leaderboard`.
 *
 * The island behind the store page's "Top players" panel.
 *
 * ── WHY THIS EXISTS BESIDE `/api/v1/leaderboard/<board>` ───────────────────
 *
 * That endpoint is keyed by BOARD ID, and boards are decoupled from games:
 * `boards.game_slug` is a link, not a key, so one game may carry several and a
 * board may carry none. A store page knows only the GAME slug and has no way to
 * discover the board ids, so resolving that link is this route's whole job.
 *
 * It is not a `?game=` mode on the per-board route because that route answers
 * every request with `Access-Control-Allow-Origin: *` for arbitrary game origins
 * and is the one games POST scores to. Widening its path params to accept a
 * different kind of id would put a second meaning on the one segment that decides
 * which board a submitted score lands on, which is not a thing to be clever with.
 *
 * ── THE BODY IS IDENTITY-FREE, AND THAT IS LOAD-BEARING ────────────────────
 *
 * Nothing here calls `auth()`, reads a cookie, or varies by viewer. That is what
 * lets the response carry ONE public cache header rather than the branch
 * `games/[slug]/achievements` has to make — and the reason to keep it that way:
 * the moment a "your rank" field is added, this becomes a personalised body on a
 * publicly cached URL, which hands one child's standing to a CDN edge that then
 * serves it to everyone. Per-viewer leaderboard data already has a home under
 * `/api/v1/me/` (see `me/friends/scores`); it does not belong here.
 *
 * `s-maxage=15, stale-while-revalidate=45` matches the per-board endpoint
 * deliberately: the two serve the same rows and a board that feels live on one
 * surface must not look stale on the other.
 *
 * ── FOUR QUERIES, NOT ONE ──────────────────────────────────────────────────
 *
 * One `listBoardsForGame` then one `getTopScores` per board, in parallel, capped
 * at {@link GAME_BOARD_MAX_BOARDS}. A single combined query would need its own
 * copy of the store's six whitelisted SELECT templates plus a window function,
 * and those templates carry the one-row-per-player dedup that stops a single
 * player filling a board. At a cap of three, reusing tested SQL beats saving two
 * round trips behind a 15-second CDN cache.
 *
 * THE SLUG IS NOT VALIDATED, matching the achievements GET: an unknown game and a
 * game with no board both answer `{ boards: [] }`, and resolving the whole
 * catalogue to turn one empty response into a different empty response buys
 * nothing on a public cacheable read.
 */

import {
  store,
  GAME_BOARD_MAX_BOARDS,
  GAME_BOARD_ROWS,
} from "@/app/lib/scoreboard";
import type { GameBoardPayload } from "@/app/lib/scoreboard/game-board";
import type { ApiError } from "@/sdk/src/contract";

/**
 * Public, read-only, uncredentialed — the same wildcard the per-board read
 * carries, so an embedded game can render its own game's boards without knowing
 * their ids. No `Vary: Cookie`, because there is no cookie branch to protect:
 * see the docblock.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45",
};

const UNAVAILABLE_HEADERS: Record<string, string> = { "Retry-After": "10" };

/** The wire body: every board linked to this game, best-first, capped. */
export interface GameLeaderboardResponse {
  slug: string;
  /**
   * Always `"all"` today. Present so a period switch can be added to the panel
   * without the client having to infer which window it is looking at — the store
   * already whitelists `day`/`week`, and the field is what makes that additive.
   */
  period: "all";
  boards: GameBoardPayload[];
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;

  try {
    // Capped BEFORE the per-board reads, so a game that has somehow accumulated
    // a dozen boards costs three queries rather than twelve.
    const boards = (await store.listBoardsForGame(slug)).slice(0, GAME_BOARD_MAX_BOARDS);

    const payloads = await Promise.all(
      boards.map(async (board): Promise<GameBoardPayload> => {
        const scores = await store.getTopScores(board.slug, {
          limit: GAME_BOARD_ROWS,
          period: "all",
          sort: board.sort,
        });
        return {
          boardId: board.slug,
          title: board.title,
          scoreLabel: board.scoreLabel,
          sort: board.sort,
          scores,
        };
      }),
    );

    const body: GameLeaderboardResponse = { slug, period: "all", boards: payloads };
    return Response.json(body, { headers: { ...CORS_HEADERS, ...CACHE_HEADERS } });
  } catch (error) {
    // 503, never 500, and never a cached empty body: the panel renders nothing
    // when it has nothing, so an empty 200 here would be indistinguishable from
    // "this game has no board" — and would then sit in the CDN for 15 seconds
    // telling everyone the same thing. A 503 is uncacheable and the island reads
    // it as "nothing today", which is the same silence without the lie.
    console.error(`game leaderboard GET failed for ${slug}:`, error);
    return Response.json({ error: "Leaderboard temporarily unavailable" } satisfies ApiError, {
      status: 503,
      headers: { ...CORS_HEADERS, ...UNAVAILABLE_HEADERS },
    });
  }
}

/**
 * Advertised for completeness rather than necessity: a cross-origin GET with no
 * custom headers is a simple request and is never preflighted, so the wildcard on
 * the GET response is what actually opens the read. This mirrors the per-board
 * endpoint's OPTIONS so the two public reads answer the same shape.
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" },
  });
}
