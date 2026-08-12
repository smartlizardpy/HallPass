/**
 * Challenges for the signed-in player — `GET`/`POST /api/v1/me/challenges`.
 *
 * Its own endpoint rather than fields on `/api/v1/me`, for the reason
 * `me/friends/count` states: `MeResponse` lives in the APPEND-ONLY public SDK
 * contract that third-party games consume, and hanging social data off it would
 * ship one player's inbox into every game's identity response.
 *
 * ── GET SERVES TWO CALLERS ────────────────────────────────────────────────
 * The Challenges tab wants everything; the store-page chip wants only what is
 * open on THIS game. `?game=<slug>` narrows to the latter and omits the outbox,
 * because the chip has nothing to say about challenges you sent someone else.
 * One endpoint rather than two so the client island has one thing to poll.
 *
 * ── THERE IS NO `enabled` FLAG ─────────────────────────────────────────────
 * Every read degrades to `[]` when the schema is behind the deploy, and both the
 * tab and the chip render nothing when there is nothing — so "the table is
 * missing" and "nobody has challenged you" are already the same screen. Adding a
 * probe query per poll to tell them apart would buy a distinction no surface
 * draws.
 *
 * ── THE PLAYER IS THE COOKIE, NEVER THE BODY ───────────────────────────────
 * The challenger is derived from the session, so a request cannot send a
 * challenge as somebody else. Only the TARGET comes from the body, as a
 * `public_id` — `players.id` is a Google subject and never crosses the wire.
 */

import { challenges, getForGame, getIncoming, getOutgoing } from "@/app/lib/challenges";
import { resolveChallengeBoard } from "@/app/lib/challenges/board";
import type { ChallengeReason } from "@/app/lib/challenges/config";
import type { CreateOutcome } from "@/app/lib/challenges";
import { isMissingColumnError } from "@/app/lib/db";
import { challengeCopy } from "@/app/lib/notifications/copy";
import { notifyPlayer } from "@/app/lib/notifications/deliver";
import { findGame } from "@/app/lib/games";
import { social } from "@/app/lib/social";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
  forbidden,
  isTrustedOrigin,
  unauthorized,
} from "@/app/lib/social/request-guard";

const SIGNED_OUT = { signedIn: false, incoming: [], outgoing: [] };

export async function GET(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return Response.json(SIGNED_OUT, { headers: NO_STORE });

  const game = new URL(req.url).searchParams.get("game");

  // The chip: open challenges on one game's boards, no outbox.
  if (game) {
    const incoming = await getForGame(playerId, game);
    return Response.json(
      { signedIn: true, incoming, outgoing: [] },
      { headers: NO_STORE },
    );
  }

  const [incoming, outgoing] = await Promise.all([
    getIncoming(playerId),
    getOutgoing(playerId),
  ]);
  return Response.json({ signedIn: true, incoming, outgoing }, { headers: NO_STORE });
}

/**
 * Which refusal to report, most specific first.
 *
 * A BLOCK IS REPORTED AS `not-friends`, deliberately. Blocking deletes the
 * friendship, so `isFriend` is already false whenever `isBlocked` is true; naming
 * the block would confirm to somebody that a particular person had blocked them,
 * which is the thing a block exists to avoid. See `challenges/config.ts`.
 *
 * The three limits collapse into one `rate-limited`, because "you have 50 open
 * challenges" and "you challenged them an hour ago" are the same answer to the
 * person reading it: not right now.
 */
function refusalFor(outcome: CreateOutcome): ChallengeReason {
  if (!outcome.boardExists) return "no-board";
  if (!outcome.isFriend || outcome.isBlocked) return "not-friends";
  if (!outcome.hasScore) return "no-score";
  if (outcome.isCooling || outcome.overRateLimit || outcome.overOpenCap) {
    return "rate-limited";
  }
  // Every gate passed and still no row: the table is not there, or something
  // raced us. Either way the caller cannot act on it.
  return "unavailable";
}

/** HTTP status per refusal. Shaped like `SEND_STATUS` in `me/friends`. */
const REFUSAL_STATUS: Record<ChallengeReason, number> = {
  "no-board": 404,
  "no-score": 409,
  "not-friends": 403,
  self: 400,
  "signed-out": 401,
  "bad-request": 400,
  "rate-limited": 429,
  unavailable: 503,
};

function refuse(reason: ChallengeReason): Response {
  return Response.json(
    { ok: false, sent: false, reason },
    { status: REFUSAL_STATUS[reason], headers: NO_STORE },
  );
}

export async function POST(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return refuse("bad-request");
  }

  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!to) return refuse("bad-request");

  try {
    const board = await resolveChallengeBoard(body);
    if ("reason" in board) return refuse(board.reason);

    const targetId = await social.internalIdFromPublicId(to);
    // An unknown target and a target who is not a friend are the SAME answer on
    // the wire. Distinguishing them would turn this endpoint into a way to test
    // whether a given public id exists.
    if (!targetId) return refuse("not-friends");
    if (targetId === playerId) return refuse("self");

    const outcome = await challenges.create({
      challengerId: playerId,
      targetId,
      boardId: board.boardId,
    });
    if (outcome.id === null) return refuse(refusalFor(outcome));

    // Tell them: in their bell, and on every device they have subscribed if
    // that is what they asked for. `notifyPlayer` resolves their preference for
    // this kind — the send is no longer unconditional as it was when a challenge
    // was the only thing that could notify anybody.
    //
    // AWAITED, not fired into the void: on serverless the response ending can
    // end the invocation, and a floating promise would be cancelled mid-flight
    // often enough to make notifications look flaky rather than broken. It is
    // cheap to wait for — every send is concurrent, individually timed out, and
    // `notifyPlayer` never rejects, so the challenge is already written and
    // nothing below can undo it.
    await notifyPlayer(targetId, {
      kind: "challenge_received",
      copy: challengeCopy({
        from: outcome.fromDisplayName,
        // The DISPLAY TITLE, not the slug — a notification reading "Beat their
        // score on neon-velocity-hyperdrive" is not something to put on a lock
        // screen. `findGame` is the static catalogue, so this is a lookup rather
        // than a round trip; an external game is not in it and falls back to the
        // board title.
        game: outcome.gameSlug ? (findGame(outcome.gameSlug)?.title ?? null) : null,
        boardTitle: outcome.boardTitle,
      }),
      // NO DEDUPE KEY, deliberately. A challenge row is upserted per
      // (challenger, target, board) and re-sending is already gated by the
      // cooldowns in `challenges/config.ts` — so a second delivery here means a
      // genuinely new challenge that cleared those, which is worth being told
      // about. Keying on the challenge id would suppress exactly the rematch
      // loop the feature exists for.
      dedupeKey: null,
    });

    // The name and the game came back from the create statement itself, so
    // confirming the send costs no further round trips.
    return Response.json(
      {
        ok: true,
        sent: true,
        challenge: {
          id: outcome.id,
          to: outcome.toDisplayName,
          targetScore: outcome.targetScore ?? 0,
          board: board.boardId,
          game: outcome.gameSlug,
        },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // The schema being behind the deploy is expected and quiet; anything else is
    // a real fault and must be logged before it degrades to a 503.
    if (!isMissingColumnError(error)) {
      console.error("me/challenges POST failed:", error);
    }
    return refuse("unavailable");
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("GET, POST, OPTIONS");
}
