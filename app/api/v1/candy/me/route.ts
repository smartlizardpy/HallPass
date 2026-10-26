/**
 * HallPass Candy Hunt — `GET /api/v1/candy/me`.
 *
 * The signed-in player's Halloween Candy: it SYNCS first (credits whatever the
 * achievement and championship systems have recorded and the ledger has not,
 * idempotently), then returns the balance, the recent ledger and the shelf.
 * Per-player, so `private, no-store`, same-origin only (no CORS), and the body
 * for a signed-out visitor is `{ signedIn: false, ...the public rules }`.
 * If the candy tables are not there yet the body says `available: false`
 * instead of failing. See `app/lib/candy/store.ts`.
 */

import { CANDY, getMyCandy } from "@/app/lib/candy";
import { candyInfo, shopItems } from "@/app/lib/candy/present";
import { crossSite, fail, json, sessionPlayerId } from "@/app/lib/collectibles/http";

export async function GET(req: Request): Promise<Response> {
  if (crossSite(req)) return fail(403, "Cross-site requests are not allowed");
  const info = candyInfo(CANDY, Date.now());
  const playerId = await sessionPlayerId("candy me");
  if (!playerId) return json({ signedIn: false, ...info, shop: shopItems(0) }, 200);
  const mine = await getMyCandy(playerId);
  return json({ signedIn: true, ...info, ...mine }, 200);
}
