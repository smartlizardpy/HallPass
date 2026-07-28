/**
 * Play beacon — `POST /api/v1/me/plays`.
 *
 * Records that the signed-in player opened a game, which is what makes "which
 * games do my friends play" answerable at all. That data exists nowhere else
 * today: PostHog holds a 30-day aggregate with no per-player dimension, and
 * `hp:recent` is device-local and never synced.
 *
 * A GUEST GETS `200 { recorded: false }`, NOT A 401 — deliberately different from
 * `/api/v1/me/favorites`, which does answer 401. This is a fire-and-forget beacon
 * fired on EVERY game open, so a 401 would put a red error in every signed-out
 * visitor's console on every play. Favorites is user-initiated and a failure
 * there is meaningful, so it says so.
 *
 * The client debounces per slug (see `personalization.ts`), so a player bouncing
 * between three games for an hour produces three writes, not thirty.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { isResolvedSlug } from "@/app/lib/games-store";
import { social } from "@/app/lib/social";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
} from "@/app/lib/social/request-guard";

export async function POST(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) {
    return Response.json({ ok: true, recorded: false }, { headers: NO_STORE });
  }

  let slug = "";
  try {
    const body = (await req.json()) as { slug?: unknown };
    slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  } catch {
    slug = "";
  }
  if (!slug) {
    return Response.json({ ok: false, recorded: false }, { status: 400, headers: NO_STORE });
  }

  try {
    // `isResolvedSlug`, NOT the static games array. An external game is a real
    // game a real player really played; validating against the static list is the
    // bug that makes `favorites.ts` silently drop them.
    if (!(await isResolvedSlug(slug))) {
      return Response.json({ ok: false, recorded: false }, { status: 404, headers: NO_STORE });
    }
    await social.recordPlay(playerId, slug);
    return Response.json({ ok: true, recorded: true }, { headers: NO_STORE });
  } catch (error) {
    if (!isMissingColumnError(error)) {
      console.error("me/plays failed:", error);
    }
    // Still 200: a beacon must never make noise in the player's console.
    return Response.json({ ok: true, recorded: false }, { headers: NO_STORE });
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("POST, OPTIONS");
}
