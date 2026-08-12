/**
 * HallPass claim endpoint — `POST|OPTIONS /api/v1/me/claim`.
 *
 * Attaches previously-anonymous scores to the signed-in player. A guest who
 * posted scores before authenticating received a short-lived `claimToken` with
 * each `SubmitResponse`; presenting those tokens here transfers exactly those
 * rows to their account. Like `me/handle`, this is a CREDENTIALED action keyed
 * by the Auth.js session cookie, so it is SAME-ORIGIN only. No verified session
 * → `401`.
 *
 * CORS, deliberately minimal: this is a same-origin, cookie-credentialed write,
 * so we do NOT emit a wildcard `Access-Control-Allow-Origin` (a wildcard origin
 * cannot legally carry credentials). Same-origin requests need no CORS grant at
 * all; the bare OPTIONS below simply advertises the method without opening the
 * write up cross-origin. The response is marked `private, no-store` (per-user).
 *
 * Tokens are self-authenticating (HMAC-signed); an invalid, expired, or
 * malformed token is silently skipped rather than failing the whole request,
 * and the store's `player_id IS NULL` guard means a token can never re-claim or
 * steal a score already owned by someone.
 */

import { auth } from "@/app/lib/auth";
import { store, verifyClaimToken, MAX_CLAIM_TOKENS } from "@/app/lib/scoreboard";
import { resolveChallengesForScore } from "@/app/lib/challenges";
import type { Session } from "next-auth";
import type { ApiError, ClaimRequest, ClaimResponse } from "@/sdk/src/contract";

const NO_STORE: Record<string, string> = { "Cache-Control": "private, no-store" };

export async function POST(req: Request): Promise<Response> {
  // No silent anonymous fallback here: unlike the public leaderboard, this is a
  // gated same-origin action, so a missing/invalid session is simply "not signed
  // in" → 401.
  let session: Session | null = null;
  try {
    session = await auth();
  } catch (error) {
    console.error("me/claim POST auth() failed:", error);
    session = null;
  }

  const playerId = session?.user?.playerId;
  if (!playerId) {
    return Response.json({ error: "Sign in required" } satisfies ApiError, {
      status: 401,
      headers: NO_STORE,
    });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" } satisfies ApiError, {
      status: 400,
      headers: NO_STORE,
    });
  }
  const { tokens } = (payload ?? {}) as Partial<ClaimRequest>;
  if (!Array.isArray(tokens) || !tokens.every((t) => typeof t === "string")) {
    return Response.json({ error: "tokens must be an array of strings" } satisfies ApiError, {
      status: 400,
      headers: NO_STORE,
    });
  }

  // Cap the batch, verify each token, and collect the score ids from those that
  // pass. Invalid/expired tokens are dropped silently. `claimScores` handles an
  // empty list by returning no rows, so no valid tokens simply claims nothing.
  const scoreIds: number[] = [];
  for (const token of tokens.slice(0, MAX_CLAIM_TOKENS)) {
    const claim = verifyClaimToken(token);
    if (claim) scoreIds.push(claim.scoreId);
  }

  // Degrade gracefully like the leaderboard routes so a transient Neon blip is
  // a soft 503 (the SDK keeps the tokens and retries on the next auth signal)
  // rather than a bare 500.
  let claimedRows: { boardId: string; score: number }[] = [];
  try {
    claimedRows = await store.claimScores(playerId, scoreIds);
  } catch (error) {
    console.error("me/claim POST claimScores failed:", error);
    return Response.json({ error: "Claim temporarily unavailable" } satisfies ApiError, {
      status: 503,
      headers: NO_STORE,
    });
  }

  // CLOSE ANY CHALLENGE THESE SCORES JUST WON.
  //
  // Without this the whole play-first flow has no ending: somebody follows a
  // challenge link, plays signed out, beats the score, signs in to keep it —
  // and the challenge they came for stays open, because resolution had only
  // ever run on the live submission path, which skips anonymous rows for the
  // good reason that an anonymous row has nobody to be. It is also the fix for
  // the same hole on ordinary friend challenges, which predates links.
  //
  // AFTER the transfer, and in its own guard, matching the score route exactly:
  // the scores are already the player's by the time this runs, and a challenge
  // that stays open a while longer is recoverable — the next qualifying score
  // closes it — where a claim reported as failed is not. `resolveChallengesForScore`
  // is the wrapped write in `challenges/index.ts` and never throws, so this is
  // belt to that brace.
  //
  // Sequential rather than concurrent: a claim carries a handful of rows at
  // most (`MAX_CLAIM_TOKENS`), and each resolution is a single UPDATE against
  // the same few rows, so firing them together would buy nothing and could have
  // two of them contend for the same challenge.
  try {
    for (const row of claimedRows) {
      await resolveChallengesForScore({
        playerId,
        boardId: row.boardId,
        score: row.score,
      });
    }
  } catch (error) {
    console.error("me/claim POST challenge resolution failed:", error);
  }

  return Response.json(
    { ok: true, claimed: claimedRows.length } satisfies ClaimResponse,
    { headers: NO_STORE },
  );
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
