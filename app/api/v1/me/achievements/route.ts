/**
 * The signed-in player's trophy case — `GET|OPTIONS /api/v1/me/achievements`.
 *
 * Everything this player has EARNED, across every game, newest first, plus the
 * point total that `badges.ts` treats as one of its inputs. This is what the
 * account page renders; the per-game shelf lives at
 * `/api/v1/games/[slug]/achievements` and is a different question (that one
 * includes locked and in-progress rows, this one does not).
 *
 * A GUEST GETS `200 { signedIn:false, achievements:[], points:0 }`, not a 401 —
 * the same shape and the same reasoning as `/api/v1/me/favorites`' GET. "Nobody
 * is signed in" is an answer, not a failure, and the account page renders a
 * sign-in prompt from it without a branch on the status code.
 *
 * CORS, deliberately minimal, mirroring `/api/v1/me/favorites` rather than
 * `/api/v1/me`: this body is a cross-game record of one child's activity, so
 * unlike the identity endpoint there is no case for letting a third-party embed
 * read it. No `Access-Control-Allow-Origin` is emitted at all, and the OPTIONS
 * below only advertises the method.
 *
 * `private, no-store` ON EVERY RESPONSE, unconditionally — there is no
 * identity-free branch here the way there is on the per-game shelf, because
 * every byte of this body is personal. That is why this route has no cache
 * decision to get wrong.
 */

import { isMissingColumnError } from "@/app/lib/db";
import {
  getAchievementPoints,
  getEarnedAchievements,
  type EarnedAchievement,
} from "@/app/lib/achievements";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
} from "@/app/lib/social/request-guard";

type MeAchievementsBody = {
  signedIn: boolean;
  achievements: EarnedAchievement[];
  /** Total points across every game. Feeds the points-derived platform badge. */
  points: number;
};

const GUEST: MeAchievementsBody = { signedIn: false, achievements: [], points: 0 };

export async function GET(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) {
    return Response.json(GUEST, { headers: NO_STORE });
  }

  // Passed through raw: the store clamps to 1..200 itself, and re-clamping here
  // would create a second ceiling that can drift from the real one. A missing or
  // unparseable value becomes `undefined`, which selects the store's default.
  const rawLimit = new URL(req.url).searchParams.get("limit");
  const parsedLimit = rawLimit === null ? NaN : Number(rawLimit);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;

  try {
    // Issued together: they read the same two tables and neither depends on the
    // other, so serialising them would double the latency of the account page's
    // slowest section for nothing.
    const [achievements, points] = await Promise.all([
      getEarnedAchievements(playerId, limit),
      getAchievementPoints(playerId),
    ]);
    return Response.json(
      { signedIn: true, achievements, points } satisfies MeAchievementsBody,
      { headers: NO_STORE },
    );
  } catch (error) {
    // Unreachable in practice — both reads are the fail-soft wrappers and
    // already degrade to `[]`/`0`. Kept so that a later addition here cannot
    // turn the account page's trophy case into a 500, and so the degraded body
    // still says `signedIn: true`: the player IS signed in, and answering
    // `false` would flash a sign-in prompt at somebody already signed in.
    if (!isMissingColumnError(error)) {
      console.error("me/achievements GET failed:", error);
    }
    return Response.json(
      { signedIn: true, achievements: [], points: 0 } satisfies MeAchievementsBody,
      { headers: NO_STORE },
    );
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("GET, OPTIONS");
}
