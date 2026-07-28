/**
 * "Friends who play this" — `GET /api/v1/me/friends/activity?slugs=a,b,c`.
 *
 * The island behind the store page's friends chip and the catalog's "your
 * friends are playing" row. It exists as a CLIENT-FETCHED endpoint rather than a
 * server read for one specific reason: it is per-viewer, and `/game/[slug]`,
 * `/` and `/category/[category]` must stay statically prerendered. A single
 * `auth()` on any of those pages makes the route dynamic, drops it from
 * `prerender-manifest.json`, and therefore drops it from the service-worker
 * precache — silently breaking offline play with no error anywhere.
 *
 * The service worker never intercepts `/api/`, so this simply fails when
 * offline; the island renders nothing rather than spinning.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { social } from "@/app/lib/social";
import type { PublicProfile } from "@/app/lib/social";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
} from "@/app/lib/social/request-guard";
import { FRIENDS_PER_GAME } from "@/app/lib/social/config";

/**
 * Cap on slugs per request. The catalog asks about a screenful of games at once;
 * anything beyond this is someone probing, and an unbounded `= ANY($1)` would let
 * one request scan the whole play table.
 */
const MAX_SLUGS = 40;

export async function GET(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) {
    return Response.json({ signedIn: false, bySlug: {} }, { headers: NO_STORE });
  }

  const raw = new URL(req.url).searchParams.get("slugs") ?? "";
  const slugs = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[a-z0-9][a-z0-9-]*$/.test(s)),
    ),
  ).slice(0, MAX_SLUGS);

  if (slugs.length === 0) {
    return Response.json({ signedIn: true, bySlug: {} }, { headers: NO_STORE });
  }

  try {
    const rows = await social.friendsPlaying(playerId, slugs);
    // Cap per slug in JS rather than with a LATERAL: the row set is already
    // bounded by MAX_FRIENDS x MAX_SLUGS and the query is ordered, so slicing
    // here is cheaper than the join complexity.
    const bySlug: Record<string, PublicProfile[]> = {};
    for (const row of rows) {
      const list = (bySlug[row.slug] ??= []);
      if (list.length < FRIENDS_PER_GAME) list.push(row.friend);
    }
    return Response.json({ signedIn: true, bySlug }, { headers: NO_STORE });
  } catch (error) {
    if (!isMissingColumnError(error)) {
      console.error("me/friends/activity failed:", error);
    }
    return Response.json({ signedIn: true, bySlug: {} }, { headers: NO_STORE });
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("GET, OPTIONS");
}
