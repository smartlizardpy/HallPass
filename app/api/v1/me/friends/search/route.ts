/**
 * Username search — `GET /api/v1/me/friends/search?q=`.
 *
 * Under `/api/v1/me/` rather than a public `/api/v1/players/search`, and that is
 * a signal, not an accident: everything under `/me/` in this codebase is
 * cookie-credentialed and emits no wildcard CORS header. Keeping the search
 * there makes "this requires a session" readable from the path alone.
 *
 * ENUMERATION IS THE STANDING RISK HERE, and it is defended in layers rather
 * than by any single check:
 *   - a session is required, so the floor is one Google account;
 *   - prefix-only, minimum 3 characters, so single letters return nothing;
 *   - a hard result cap with NO OFFSET OR CURSOR — the absence of pagination is
 *     what actually prevents walking the namespace, not the cap itself;
 *   - blocked pairs (both directions) and private profiles are excluded;
 *   - the projection carries only what a result row needs to render.
 *
 * The wildcard-escaping problem lives in the store: `_` is a legal username
 * character AND `LIKE`'s single-character wildcard, so an unescaped search for
 * `_` would match every username on the site.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { social } from "@/app/lib/social";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
} from "@/app/lib/social/request-guard";
import { SEARCH_MIN_CHARS } from "@/app/lib/social/config";
import { foldToAscii, normalizeUsername } from "@/app/lib/username";

export async function GET(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) {
    return Response.json({ results: [] }, { status: 401, headers: NO_STORE });
  }

  const raw = new URL(req.url).searchParams.get("q") ?? "";
  // FOLD, DO NOT REJECT. This used to normalise to the username charset and
  // return nothing for anything outside it, on the reasoning that a character no
  // username can contain cannot match one. That was true while search matched
  // usernames only. It stopped being true when search started matching DISPLAY
  // names, which are free-form: "Ateş Demir" is a real player on this site, and a
  // Turkish keyboard types "ş" without being asked — so the query was discarded
  // here and never reached the database, and the search that mattered most to the
  // people using it always came back empty.
  const q = foldToAscii(normalizeUsername(raw));

  // Below the floor is an empty result, not an error: the client types into this
  // continuously and a 400 per keystroke would be noise. Measured AFTER folding,
  // since that is the string that will actually be matched.
  if (q.length < SEARCH_MIN_CHARS) {
    return Response.json({ results: [] }, { headers: NO_STORE });
  }
  // What survives folding still has to be something a name can contain. A query
  // of pure emoji folds to nothing matchable, and querying for it is wasted work
  // rather than a useful result.
  if (!/^[a-z0-9_ ]+$/.test(q)) {
    return Response.json({ results: [] }, { headers: NO_STORE });
  }

  try {
    const results = await social.searchPlayers(playerId, q);
    return Response.json({ results }, { headers: NO_STORE });
  } catch (error) {
    if (!isMissingColumnError(error)) {
      console.error("me/friends/search failed:", error);
    }
    return Response.json({ results: [] }, { headers: NO_STORE });
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("GET, OPTIONS");
}
