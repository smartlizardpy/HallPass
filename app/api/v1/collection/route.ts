/**
 * HallPass collection — `GET /api/v1/collection`.
 *
 * The signed-in player's sealed packs, recent openings, binder and per-collection
 * progress. Per-player, so `private, no-store`, same-origin only (no CORS), and
 * `401` without a session. If the collectibles tables are not there yet the body
 * says `available: false` instead of failing.
 */

import { getMyCollection } from "@/app/lib/collectibles";
import { fail, json, sessionPlayerId } from "@/app/lib/collectibles/http";

export async function GET(): Promise<Response> {
  const playerId = await sessionPlayerId("GET");
  if (!playerId) return fail(401, "Sign in required");
  const mine = await getMyCollection(playerId);
  return json(mine, 200);
}
