/**
 * HallPass public leaderboard endpoint — `GET|POST|OPTIONS /api/v1/leaderboard/<game>`.
 *
 * This is the only scoreboard surface games talk to from the browser, so every
 * response carries permissive CORS headers (it is public, read-mostly data; no
 * credentials are involved). The `<slug>` is validated against the static
 * `games` list — an unknown slug is a 404 before any database work, so the API
 * never provisions or queries boards for games that do not exist.
 *
 * Caching: the GET response sets `s-maxage=15, stale-while-revalidate=45` so the
 * CDN can absorb bursty reads while a board still feels live. Route handlers are
 * NOT cached by default in this Next.js, and we deliberately do not opt into
 * `force-static` — each request reads the database at request time.
 */

import { games } from "@/app/lib/games";
import {
  store,
  sanitizeHandle,
  isValidScore,
  clientKeyFromHeaders,
  hashIp,
  clampLimit,
  normalizePeriod,
  DEFAULT_LIMIT,
} from "@/app/lib/scoreboard";
import type {
  ApiError,
  LeaderboardResponse,
  SubmitResponse,
} from "@/sdk/src/contract";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45",
};

const UNAVAILABLE_HEADERS: Record<string, string> = { "Retry-After": "10" };

function jsonResponse(
  body: unknown,
  status: number,
  extra?: Record<string, string>,
): Response {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, ...extra } });
}

function isKnownGame(slug: string): boolean {
  return games.some((game) => game.slug === slug);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  if (!isKnownGame(slug)) {
    return jsonResponse({ error: "Unknown game" } satisfies ApiError, 404);
  }

  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam === null ? DEFAULT_LIMIT : clampLimit(Number(limitParam));
  const period = normalizePeriod(url.searchParams.get("period"));

  try {
    const board = await store.getBoard(slug);
    if (!board) {
      return jsonResponse({ error: "Board not initialized" } satisfies ApiError, 409);
    }
    const scores = await store.getTopScores(slug, { limit, period, sort: board.sort });
    const body: LeaderboardResponse = {
      game: board.slug,
      title: board.title,
      scoreLabel: board.scoreLabel,
      sort: board.sort,
      period,
      scores,
    };
    return jsonResponse(body, 200, CACHE_HEADERS);
  } catch (error) {
    console.error(`leaderboard GET failed for ${slug}:`, error);
    return jsonResponse(
      { error: "Leaderboard temporarily unavailable" } satisfies ApiError,
      503,
      UNAVAILABLE_HEADERS,
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" } satisfies ApiError, 400);
  }
  if (!isKnownGame(slug)) {
    return jsonResponse({ error: "Unknown game" } satisfies ApiError, 404);
  }
  const { score, handle } = (payload ?? {}) as { score?: unknown; handle?: unknown };

  let board;
  try {
    board = await store.getBoard(slug);
  } catch (error) {
    console.error(`leaderboard POST getBoard failed for ${slug}:`, error);
    return jsonResponse(
      { error: "Leaderboard temporarily unavailable" } satisfies ApiError,
      503,
      UNAVAILABLE_HEADERS,
    );
  }
  if (!board) {
    return jsonResponse({ error: "Board not initialized" } satisfies ApiError, 409);
  }

  if (!isValidScore(score, board.maxScore)) {
    return jsonResponse({ error: "Invalid score" } satisfies ApiError, 400);
  }
  // The score column is BIGINT; truncate any fractional value to an integer so a
  // float score (e.g. a timer or computed value) stores cleanly rather than
  // erroring as a 503 on insert.
  const intScore = Math.trunc(score);

  const cleanHandle = sanitizeHandle(typeof handle === "string" ? handle : undefined);
  const ipHash = hashIp(clientKeyFromHeaders(req.headers));

  let result;
  try {
    result = await store.appendScore(
      slug,
      { handle: cleanHandle, score: intScore, ipHash },
      board.sort,
    );
  } catch (error) {
    console.error(`leaderboard POST appendScore failed for ${slug}:`, error);
    return jsonResponse(
      { error: "Leaderboard temporarily unavailable" } satisfies ApiError,
      503,
      UNAVAILABLE_HEADERS,
    );
  }

  if (!result.ok) {
    return jsonResponse(
      { error: "Too many submissions, slow down" } satisfies ApiError,
      429,
      UNAVAILABLE_HEADERS,
    );
  }

  const body: SubmitResponse = {
    ok: true,
    rank: result.rank,
    handle: cleanHandle,
    score: intScore,
  };
  return jsonResponse(body, 200);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
