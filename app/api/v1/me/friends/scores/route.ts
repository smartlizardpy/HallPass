/**
 * "You and your friends on this board" — `GET /api/v1/me/friends/scores?slug=<game>`.
 *
 * The island behind the store page's friends panel. It sits beside
 * `friends/activity` and shares every one of its constraints, for the same
 * reasons written out there: it is PER-VIEWER, and `/game/[slug]` must stay
 * statically prerendered, so a server read on that page would make the route
 * dynamic, drop it from `prerender-manifest.json`, and therefore drop every game
 * page from the service-worker precache — silently breaking offline play with no
 * error anywhere.
 *
 * WHY THIS IS NOT `?scope=friends` ON `/api/v1/leaderboard/<board>`. That route
 * answers `Access-Control-Allow-Origin: *` with no credentials on purpose, because
 * games call it cross-origin. A per-viewer scope there would mean credentialed
 * CORS for arbitrary game origins, which is a materially larger security surface
 * than this panel is worth. Per-viewer reads live under `/api/v1/me/`, where the
 * cookie is the whole authorisation story and the OPTIONS handler advertises no
 * origin at all.
 *
 * The slug is the GAME's, not a board id: the caller is a store page and does not
 * know what boards a game has. Resolving that link is the query's job.
 *
 * Fails SOFT and quiet. An unconfigured or migrating database answers an empty
 * panel rather than a 500, because the surface it feeds renders nothing when it
 * has nothing to say — the failure mode and the ordinary empty case are the same
 * shape on purpose.
 *
 * ── `friends` IS COUNTED ONLY WHEN IT CAN CHANGE THE ANSWER ────────────────
 * "Nobody you know has scored here" and "you have not added anybody yet" are
 * different sentences and want different buttons, and the standings alone cannot
 * tell them apart: both come back as a response holding at most the caller's own
 * row. So a second query resolves it — but ONLY in that case. Once a single
 * friend row exists the panel is a race and no prompt is rendered, which makes
 * the count unreadable, and the common path stays at one round trip.
 */

import { isMissingColumnError, isUnconfiguredDbError } from "@/app/lib/db";
import { store } from "@/app/lib/scoreboard";
import type { FriendStanding } from "@/app/lib/scoreboard/store";
import { social } from "@/app/lib/social";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
} from "@/app/lib/social/request-guard";

/** The slug shape every game route in this repo validates against. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export async function GET(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) {
    return Response.json(
      { signedIn: false, standings: [], friends: 0 },
      { headers: NO_STORE },
    );
  }

  const slug = (new URL(req.url).searchParams.get("slug") ?? "").trim();
  if (!SLUG.test(slug)) {
    return Response.json(
      { signedIn: true, standings: [], friends: 0 },
      { headers: NO_STORE },
    );
  }

  let standings: FriendStanding[] = [];
  let friends = 0;
  try {
    standings = await store.getFriendStandingsForGame(playerId, slug);
    if (!standings.some((row) => !row.isYou)) {
      friends = (await social.counts(playerId)).friends;
    }
  } catch (error) {
    // A database that is not configured, or a column a pending migration has not
    // added yet, is not worth a log line on every request — the same triage
    // `friends/activity` applies.
    if (!isMissingColumnError(error) && !isUnconfiguredDbError(error)) {
      console.error("me/friends/scores failed:", error);
    }
  }

  return Response.json({ signedIn: true, standings, friends }, { headers: NO_STORE });
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("GET, OPTIONS");
}
