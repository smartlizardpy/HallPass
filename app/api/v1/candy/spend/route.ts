/**
 * HallPass Candy Hunt — `POST /api/v1/candy/spend`.
 *
 * Body: `{ packId: string, requestId: string }`. `requestId` is chosen by the
 * client (a fresh `crypto.randomUUID()` per tap of "Buy"; 8 to 64 characters of
 * A-Z a-z 0-9 _ -) and is what makes a double-tap, a retry after a dropped
 * response, or a second tab buy ONCE: a repeat returns the same pack with
 * `alreadySpent: true` and the current balance.
 *
 * Same-origin and credentialed. `403` cross-site, `401` signed out, `400` a bad
 * body, unknown or unpriced pack, or malformed `requestId`, `409` not enough
 * candy, `410` spending closed (not open yet, or past the spend-by date), `503`
 * a database failure (nothing was spent: try again with the SAME `requestId`).
 * The debit and the sealed pack are one transaction; see
 * `app/lib/candy/store.ts#spend`.
 */

import { candyStore } from "@/app/lib/candy";
import { REQUEST_ID_RE } from "@/app/lib/candy/store";
import { getPack } from "@/app/lib/collectibles/catalogue";
import { crossSite, fail, json, sessionPlayerId } from "@/app/lib/collectibles/http";

export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return fail(403, "Cross-site requests are not allowed");
  const playerId = await sessionPlayerId("candy spend");
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

  let result;
  try {
    result = await candyStore.spend(playerId, packId, requestId);
  } catch (error) {
    console.error("candy spend failed:", error);
    return json({ error: "Spending is temporarily unavailable. Nothing was spent: try again." }, 503, { "Cache-Control": "private, no-store", "Retry-After": "5" });
  }
  switch (result.status) {
    case "bad-pack":
      return fail(400, "That pack is not for sale");
    case "bad-request":
      return fail(400, "That request id was already used for something else");
    case "closed":
      return json(
        { error: result.reason === "expired" ? "Candy can no longer be spent: the spend-by date has passed" : "Candy cannot be spent yet", reason: result.reason },
        410,
      );
    case "insufficient":
      return json({ error: "Not enough candy", balance: result.balance, price: result.price }, 409);
    case "ok":
      return json(
        {
          ok: true,
          alreadySpent: result.alreadySpent,
          balance: result.balance,
          price: result.price,
          pack: { id: result.packPublicId, packId: result.packId, name: getPack(result.packId)?.name ?? result.packId },
        },
        200,
      );
  }
}
