/**
 * HallPass public leaderboard endpoint — `GET|POST|OPTIONS /api/v1/leaderboard/<game>`.
 *
 * This is the only scoreboard surface games talk to from the browser, so every
 * response carries permissive CORS headers (it is public, read-mostly data; no
 * credentials are involved). The `<slug>` path param is the BOARD ID (boards are
 * decoupled from games); an id with no provisioned board answers 409 ("Board not
 * initialized") rather than a 404, so the API never queries scores for a board
 * that does not exist.
 *
 * Caching: the GET response sets `s-maxage=15, stale-while-revalidate=45` so the
 * CDN can absorb bursty reads while a board still feels live. Route handlers are
 * NOT cached by default in this Next.js, and we deliberately do not opt into
 * `force-static` — each request reads the database at request time.
 */

import {
  store,
  sanitizeHandle,
  isValidScore,
  clientKeyFromHeaders,
  hashIp,
  clampLimit,
  normalizePeriod,
  createClaimToken,
  DEFAULT_LIMIT,
} from "@/app/lib/scoreboard";
import { auth } from "@/app/lib/auth";
import { resolveChallengesForScore } from "@/app/lib/challenges";
import { getPublicIdentity, upsertPlayerOnLogin } from "@/app/lib/players";
import type { Session } from "next-auth";
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;

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

  const ipHash = hashIp(clientKeyFromHeaders(req.headers));

  // Resolve the verified player identity from the SAME-ORIGIN session cookie, if
  // any. Reading auth() must NEVER break this public endpoint: any failure (no
  // cookie, malformed token, a cross-origin request that carries none) collapses
  // to "no session" and the submission proceeds anonymously, exactly as before.
  let session: Session | null = null;
  try {
    session = await auth();
  } catch (error) {
    console.error(`leaderboard POST auth() failed for ${slug}:`, error);
    session = null;
  }

  // Default: anonymous — the sanitised submitted handle, no player id. A verified
  // session overrides the handle with the player's effective display and tags the
  // score with their id. The player-resolution DB calls are wrapped so a transient
  // identity-store hiccup degrades to the submitted handle (still tagged by id)
  // rather than failing an otherwise-valid submission.
  let playerId: string | null = null;
  let cleanHandle = sanitizeHandle(typeof handle === "string" ? handle : undefined);

  const sessionPlayerId = session?.user?.playerId;
  if (sessionPlayerId) {
    playerId = sessionPlayerId;
    try {
      const email = session?.user?.email;
      if (email) {
        // Defensively refresh the player row (the login-time upsert may have been
        // missed). Skipped when no email is present — the NOT NULL/UNIQUE column
        // would reject it — but the score still tags the existing row by id.
        await upsertPlayerOnLogin({
          id: sessionPlayerId,
          email,
          name: session?.user?.name,
          image: session?.user?.image,
        });
      }
      const ident = await getPublicIdentity(sessionPlayerId);
      if (ident) cleanHandle = ident.handle;
    } catch (error) {
      console.error(`leaderboard POST player resolve failed for ${slug}:`, error);
    }
  }

  let result;
  try {
    result = await store.appendScore(
      slug,
      { handle: cleanHandle, score: intScore, ipHash, playerId },
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

  // The score is now recorded and nothing below may endanger it.
  //
  // Close any challenge this score just won. ONLY FOR A SIGNED-IN PLAYER: a
  // challenge names a specific target, so an anonymous row has nobody to be, and
  // skipping it here keeps the extra statement off the guest path entirely.
  //
  // `resolveChallengesForScore` is the one deliberately wrapped write in
  // `challenges/index.ts` — it degrades to `[]` rather than throwing, because a
  // missing or broken challenges table must never turn a successful submission
  // into an error the player did not cause and cannot act on. An unresolved
  // challenge is closed by the next qualifying score; a lost score is gone.
  if (playerId !== null) {
    await resolveChallengesForScore({ playerId, boardId: slug, score: intScore });
  }

  const body: SubmitResponse = {
    ok: true,
    rank: result.rank,
    handle: cleanHandle,
    score: intScore,
  };
  // An ANONYMOUS row (no resolved player) gets a short-lived claim token so the
  // guest can later attach this exact score to a signed-in account via POST
  // /api/v1/me/claim. Never mint one for an account-attributed row, and omit it
  // when claiming is disabled server-side (createClaimToken returns null).
  if (playerId === null) {
    const claimToken = createClaimToken(result.id, slug);
    if (claimToken) body.claimToken = claimToken;
  }
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
