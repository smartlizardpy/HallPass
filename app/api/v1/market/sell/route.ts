/**
 * HallPass Market — `POST /api/v1/market/sell`: sell ONE spare copy of a card back
 * for a fraction of its value. Body: `{ collectibleId }`. Only a duplicate sells.
 * `403` cross-site, `401` signed out, `400` unknown card, `409` no spare copy,
 * `503` database failure.
 */

import { hallTokens } from "@/app/lib/hall-tokens";
import { crossSite, fail, json, sessionPlayerId } from "@/app/lib/collectibles/http";

export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return fail(403, "Cross-site requests are not allowed");
  const playerId = await sessionPlayerId("market sell");
  if (!playerId) return fail(401, "Sign in required");

  let collectibleId = "";
  try {
    const parsed = (await req.json()) as { collectibleId?: unknown };
    collectibleId = typeof parsed?.collectibleId === "string" ? parsed.collectibleId : "";
  } catch {
    return fail(400, "Invalid JSON body");
  }
  if (!collectibleId) return fail(400, "collectibleId is required");

  try {
    const r = await hallTokens.sellBack(playerId, collectibleId);
    if (r.status === "bad-card") return fail(400, "That card cannot be sold");
    if (r.status === "no-spare-copy") return fail(409, "You need a spare copy: you keep one of every card");
    return json({ ok: true, collectibleId: r.collectibleId, credited: r.credited, balance: r.balance }, 200);
  } catch (error) {
    console.error("market sell failed:", error);
    return json({ error: "The market is temporarily unavailable. Nothing was sold: try again." }, 503, { "Cache-Control": "private, no-store", "Retry-After": "5" });
  }
}
