/**
 * HallPass Market — `POST /api/v1/market/buy-pack`.
 *
 * Body: `{ packId, requestId }`. `requestId` is a fresh client uuid per tap of
 * "Buy" (8 to 64 of A-Z a-z 0-9 _ -); it makes a double tap, retry or second tab
 * buy ONCE. Same-origin and credentialed. `403` cross-site, `401` signed out,
 * `400` bad body / pack not for sale / reused request id, `409` not enough
 * tokens, `503` database failure (nothing was spent: retry with the SAME id).
 * Debit and sealed pack are one transaction (`hall-tokens/store.ts#buyPack`).
 */

import { hallTokens } from "@/app/lib/hall-tokens";
import { REQUEST_ID_RE } from "@/app/lib/hall-tokens/store";
import { getPack } from "@/app/lib/collectibles/catalogue";
import { crossSite, fail, json, sessionPlayerId } from "@/app/lib/collectibles/http";

export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return fail(403, "Cross-site requests are not allowed");
  const playerId = await sessionPlayerId("market buy");
  if (!playerId) return fail(401, "Sign in required");

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return fail(400, "Invalid JSON body");
  }
  const { packId, requestId } = body;
  if (typeof packId !== "string" || !packId) return fail(400, "packId is required");
  if (typeof requestId !== "string" || !REQUEST_ID_RE.test(requestId)) {
    return fail(400, "requestId must be 8 to 64 letters, digits, dashes or underscores");
  }

  try {
    const r = await hallTokens.buyPack(playerId, packId, requestId);
    switch (r.status) {
      case "bad-pack":
        return fail(400, "That pack is not for sale");
      case "bad-request":
        return fail(400, "That request id was already used for something else");
      case "insufficient":
        return json({ error: "Not enough Hall Tokens", balance: r.balance, price: r.price }, 409);
      case "ok":
        return json(
          {
            ok: true,
            alreadyBought: r.alreadyBought,
            balance: r.balance,
            price: r.price,
            pack: { id: r.packPublicId, packId: r.packId, name: getPack(r.packId)?.name ?? r.packId },
          },
          200,
        );
    }
  } catch (error) {
    console.error("market buy-pack failed:", error);
    return json({ error: "The market is temporarily unavailable. Nothing was spent: try again." }, 503, { "Cache-Control": "private, no-store", "Retry-After": "5" });
  }
}
