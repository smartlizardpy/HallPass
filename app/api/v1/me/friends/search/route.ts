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
import { normalizeUsername } from "@/app/lib/username";

export async function GET(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) {
    return Response.json({ results: [] }, { status: 401, headers: NO_STORE });
  }

  const raw = new URL(req.url).searchParams.get("q") ?? "";
  const q = normalizeUsername(raw);

  // Below the floor is an empty result, not an error: the client types into this
  // continuously and a 400 per keystroke would be noise.
  if (q.length < SEARCH_MIN_CHARS) {
    return Response.json({ results: [] }, { headers: NO_STORE });
  }
  // Anything outside the username charset cannot match a stored username, so
  // there is no point querying for it.
  if (!/^[a-z0-9_]+$/.test(q)) {
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
