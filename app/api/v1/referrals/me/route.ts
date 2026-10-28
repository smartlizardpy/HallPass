/**
 * HallPass referrals — `GET /api/v1/referrals/me`.
 *
 * The signed-in player's invite token and counts (friends waiting, friends
 * rewarded, candy earned, rewards remaining). It first attributes a pending
 * cookie to this player (a friend who landed, then signed in) and reconciles
 * any reward owed, so a missed hook is repaired by looking. Per-player, so
 * `private, no-store`; same-origin only. Signed out: the public rules only.
 * See `app/lib/referrals/store.ts`.
 */

import { REFERRALS, attributeFromRequest, getMine, referralStore } from "@/app/lib/referrals";
import { rulesFrom } from "@/app/lib/referrals/config";
import { crossSite, fail, json, referralPlayer } from "@/app/lib/referrals/http";

export async function GET(req: Request): Promise<Response> {
  if (crossSite(req)) return fail(403, "Cross-site requests are not allowed");
  const base = {
    event: REFERRALS.eventId,
    path: REFERRALS.path,
    param: REFERRALS.param,
    opensAt: REFERRALS.opensAt,
    closesAt: REFERRALS.closesAt,
  };
  const playerId = await referralPlayer("me");
  if (!playerId) {
    const rules = await referralStore.rules().catch(() => rulesFrom(REFERRALS, null));
    return json({ signedIn: false, ...base, available: true, rules }, 200);
  }
  await attributeFromRequest(req, playerId);
  const mine = await getMine(playerId);
  return json({ signedIn: true, ...base, ...mine }, 200);
}
