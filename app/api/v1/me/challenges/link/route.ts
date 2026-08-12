/**
 * Share links for the signed-in player — `POST|DELETE|OPTIONS
 * /api/v1/me/challenges/link`.
 *
 *   POST   { board } | { game } → { ok, code, path, targetScore, … }
 *   DELETE { code }             → { ok, revoked }
 *
 * Under `/me/` because both are credentialed writes scoped to the caller's own
 * account: the owner comes from the session cookie and never from the body, so
 * a request cannot mint or kill a link belonging to somebody else. Taking a
 * link UP is the public half and lives at
 * `/api/v1/challenges/link/[code]` — it must work with no session at all.
 *
 * ── POST IS "SHARE", NOT "CREATE" ──────────────────────────────────────────
 * It is an upsert keyed on (owner, board), so pressing share twice is one link
 * whose score has been refreshed rather than two links competing for the same
 * dare. Callers can therefore treat it as idempotent and simply ask again
 * whenever they need the URL.
 *
 * ── HOSTED GAMES ONLY, AND THE REASON IS NOT POLICY ────────────────────────
 * `sdk/src/client.ts` mints an anonymous claim token only for a `sameOrigin`
 * submission, so on a cross-origin game there is nothing for a signed-out
 * player to claim afterwards. The last three steps of the funnel — beat it,
 * sign in, keep the score — cannot exist there. A link on an external game
 * would still open and still play; it just could never convert anybody, which
 * is the entire point of the feature. Refusing to mint one is choosing not to
 * ship a dead end. See `challenge-sharing-design.md` §3.7.
 */

import { challenges } from "@/app/lib/challenges";
import { resolveChallengeBoard } from "@/app/lib/challenges/board";
import { challengeLinkPath, generateLinkCode, normalizeLinkCode } from "@/app/lib/challenges/link";
import { isMissingColumnError } from "@/app/lib/db";
import { resolveGame } from "@/app/lib/games-store";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
  forbidden,
  isTrustedOrigin,
  unauthorized,
} from "@/app/lib/social/request-guard";

/**
 * Why a link could not be minted.
 *
 * A superset of the send path's vocabulary rather than a reuse of it: `external`
 * has no counterpart there, and `no-score`/`no-board` mean the same thing on
 * both. `not-friends`, `self` and the cooldowns cannot arise — there is nobody
 * on the other end of a link yet, which is the whole difference.
 */
type LinkRefusal =
  | "no-board"
  | "no-score"
  | "external"
  | "bad-request"
  | "unavailable";

const REFUSAL_STATUS: Record<LinkRefusal, number> = {
  "no-board": 404,
  "no-score": 409,
  external: 409,
  "bad-request": 400,
  unavailable: 503,
};

function refuse(reason: LinkRefusal): Response {
  return Response.json(
    { ok: false, reason },
    { status: REFUSAL_STATUS[reason], headers: NO_STORE },
  );
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  const body = await readBody(req);
  if (!body) return refuse("bad-request");

  try {
    const board = await resolveChallengeBoard(body);
    if ("reason" in board) {
      // The shared resolver speaks the send path's vocabulary; only two of its
      // members can reach this surface, and both mean the same here.
      return refuse(board.reason === "no-board" ? "no-board" : "bad-request");
    }

    // Mint FIRST, then check the game — because the board's game slug is not
    // known until the statement that resolves the board has run, and this is
    // the cheapest ordering that avoids a second lookup. The write is an
    // idempotent upsert, so an external game that slips through here is
    // corrected on the next line rather than leaving anything inconsistent.
    const outcome = await challenges.mintLink({
      ownerId: playerId,
      boardId: board.boardId,
      code: generateLinkCode(),
    });

    if (!outcome.boardExists) return refuse("no-board");
    if (!outcome.hasScore) return refuse("no-score");
    if (outcome.code === null) return refuse("unavailable");

    // A board with no game cannot be external — there is no off-site URL to be
    // hosted at — so a null slug passes.
    if (outcome.gameSlug) {
      const game = await resolveGame(outcome.gameSlug).catch(() => undefined);
      if (game?.externalUrl) {
        // Undo it. Minting ran before this could be known, and leaving a
        // mintable-but-unshareable link in the table would put a row in the
        // owner's outbox for a URL the UI will never show them.
        await challenges.revokeLink({ ownerId: playerId, code: outcome.code });
        return refuse("external");
      }
    }

    return Response.json(
      {
        ok: true,
        code: outcome.code,
        // Site-relative: the browser builds the shareable URL from its own
        // origin, so a preview deployment shares a preview link.
        path: challengeLinkPath(outcome.code),
        targetScore: outcome.targetScore,
        game: outcome.gameSlug,
        boardTitle: outcome.boardTitle,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (isMissingColumnError(error)) return refuse("unavailable");
    console.error("me/challenges/link POST failed:", error);
    return refuse("unavailable");
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  const body = await readBody(req);
  if (!body) return refuse("bad-request");

  const code = normalizeLinkCode(typeof body.code === "string" ? body.code : "");
  if (!code) return refuse("bad-request");

  try {
    // Scoped to the owner in SQL, so holding a code is not authority to kill
    // the link — anybody who was sent one holds it.
    const revoked = await challenges.revokeLink({ ownerId: playerId, code });
    // `false` means "already revoked, or not yours", and both answer the same:
    // as far as this caller is concerned the link is not live. Separating them
    // would confirm that a given code belongs to somebody else.
    return Response.json({ ok: true, revoked }, { headers: NO_STORE });
  } catch (error) {
    if (isMissingColumnError(error)) return refuse("unavailable");
    console.error("me/challenges/link DELETE failed:", error);
    return refuse("unavailable");
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("POST, DELETE, OPTIONS");
}
