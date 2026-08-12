/**
 * Taking a challenge link up — `POST|OPTIONS /api/v1/challenges/link/[code]`.
 *
 * ── WHY THIS IS NOT UNDER `/me/` ───────────────────────────────────────────
 * Every other challenge write requires a session. This one MUST NOT: it is
 * called the instant somebody presses "Beat it" on `/c/<code>`, and at that
 * moment most callers have no account — that is the entire premise of the
 * feature. A 401 here would be a wall in front of the one step the whole design
 * exists to keep free.
 *
 * So it does two different things depending on who is asking, in one endpoint
 * because the caller is one button:
 *
 *   - SIGNED OUT → count the press. Nothing is written about the person,
 *     because nothing is known about them and nothing needs to be.
 *   - SIGNED IN  → count the press AND record them as a taker, which creates a
 *     real, resolvable challenge that the ordinary score path will close when
 *     they beat it.
 *
 * ── IT ALWAYS RETURNS 200 ──────────────────────────────────────────────────
 * A revoked link, a rate-limited claimer, a blocked pair, the owner pressing
 * their own button, a database that is behind the deploy: every one of them
 * answers `{ ok: true, claimed: false }` with a reason. The button's job is to
 * open a game, and the game opens in all of those cases. Only a malformed code
 * is a 400, because there is no game to open behind one.
 *
 * That is deliberately unlike the send path, which reports refusals as 4xx and
 * shows them to the player. Nothing here is worth telling a stranger about
 * somebody else's link — "you have been blocked" and "this person revoked their
 * link" are both disclosures, and neither changes what the button does next.
 *
 * ── NO ORIGIN CHECK ────────────────────────────────────────────────────────
 * `isTrustedOrigin` guards the credentialed writes under `/me/`, where the risk
 * is a third-party page acting as the signed-in player. The worst a forged
 * request can do here is add a row the caller could have added by pressing a
 * public button, or increment a counter — and the claimer is the person who
 * benefits, so there is nobody to attack. The rate limit in
 * `challenges/config.ts` is what bounds it.
 */

import { challenges, noteLinkOpen } from "@/app/lib/challenges";
import { normalizeLinkCode } from "@/app/lib/challenges/link";
import { isMissingColumnError } from "@/app/lib/db";
import { NO_STORE, currentPlayerId } from "@/app/lib/social/request-guard";

/** Why nothing was recorded. Reported for telemetry, never rendered as blame. */
type NotClaimed =
  | "signed-out"
  | "missing"
  | "revoked"
  | "self"
  | "blocked"
  | "rate-limited"
  | "unavailable";

function answer(claimed: boolean, reason?: NotClaimed, targetScore?: number) {
  return Response.json(
    { ok: true, claimed, reason, targetScore },
    { headers: NO_STORE },
  );
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const raw = (await params).code;
  const code = normalizeLinkCode(raw);
  if (!code) {
    return Response.json({ ok: false, reason: "bad-request" }, {
      status: 400,
      headers: NO_STORE,
    });
  }

  // Never throws — `currentPlayerId` swallows a broken session into `null`, and
  // an anonymous press is a first-class outcome here rather than a failure.
  const playerId = await currentPlayerId();

  if (!playerId) {
    // Fail-soft by construction: the wrapper logs and returns.
    await noteLinkOpen(code);
    return answer(false, "signed-out");
  }

  try {
    const outcome = await challenges.claimLink({ code, playerId });
    if (outcome.id !== null) {
      return answer(true, undefined, outcome.targetScore ?? undefined);
    }
    if (!outcome.linkFound) return answer(false, "missing");
    if (outcome.isRevoked) return answer(false, "revoked");
    // The owner pressing their own button. Not an error, and not something to
    // scold them for — they may simply be checking what their link looks like.
    if (outcome.isSelf) return answer(false, "self");
    if (outcome.isBlocked) return answer(false, "blocked");
    if (outcome.overRateLimit) return answer(false, "rate-limited");
    return answer(false, "unavailable");
  } catch (error) {
    if (!isMissingColumnError(error)) {
      console.error(`challenges/link/${code} POST failed:`, error);
    }
    // The schema is behind the deploy, or Neon had a bad second. Either way the
    // game still opens; the challenge simply goes unrecorded.
    return answer(false, "unavailable");
  }
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
