/**
 * HallPass — who may see a STAGED game.
 *
 * A staged game (see `app/lib/game-staging.ts`) is visible and playable only to
 * beta testers and dashboard roles. Every gate that serves one — the game-html
 * and game-media routes, the reviews and leaderboard endpoints, the beta pages —
 * asks this one question, so the answer lives in one place.
 *
 * THE RULE. `true` when the session carries ANY dashboard role (they administer
 * the catalogue; making them enrol as testers to look at a game they publish
 * would be friction with no security value — the same reasoning as
 * `requireBetaTester`), or when the session's `playerId` is an ACTIVE beta tester.
 * Everyone else, including signed-out visitors, gets `false`.
 *
 * A BOOLEAN, NOT A GUARD. Unlike `requireBetaTester` this never redirects. A
 * denied request to a staged slug must look exactly like a request for a slug that
 * does not exist (a plain 404); sending a stranger to `/beta/closed` or a sign-in
 * page would confirm the game is there. Callers turn `false` into `notFound()` or
 * a 404 response themselves.
 *
 * FAILS CLOSED, AND NEVER THROWS. Any error — `auth()` failing, the membership
 * lookup failing, a missing table — resolves to `false`. "Could not confirm" must
 * mean "not allowed" here, and a route that calls this on its hot path must not
 * turn a Neon blip into a 500. (`isBetaTester` already degrades to `false` with a
 * log; the outer try/catch covers `auth()` and anything it does not.)
 *
 * CALL IT ONLY FOR STAGED SLUGS. `auth()` reads cookies, which makes a caller
 * dynamic. Public pages and routes must not call it for ordinary games, or they
 * lose their static/cached behaviour. Check `isStagedSlug(slug)` first and reach
 * for this only when it is true.
 */

import "server-only";
import { auth } from "@/app/lib/auth";
import { isBetaTester } from "@/app/lib/beta";

/** May the current request see staged games? Fail-closed; never throws. */
export async function canViewStaged(): Promise<boolean> {
  try {
    const session = await auth();
    if (session?.user?.role) return true;
    const playerId = session?.user?.playerId;
    if (!playerId) return false;
    return await isBetaTester(playerId);
  } catch (error) {
    console.error("canViewStaged failed; denying:", error);
    return false;
  }
}
