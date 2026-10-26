/**
 * HallPass collection prefs — `POST /api/v1/collection/prefs`.
 *
 * Body is one of:
 *   `{ collectibleId, favourite?: boolean, featuredPosition?: 1..6 | null }`
 *   `{ seen: string[] }`   (clears the NEW dot on those cards)
 *
 * Same-origin and credentialed. Only cards the player owns can be favourited or
 * featured (`404` otherwise). Featuring a card in a slot moves it out of whatever
 * held that slot.
 */

import { collectiblesStore } from "@/app/lib/collectibles";
import { MAX_FEATURED } from "@/app/lib/collectibles/store";
import { getCollectible } from "@/app/lib/collectibles/catalogue";
import { crossSite, fail, json, sessionPlayerId } from "@/app/lib/collectibles/http";

export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return fail(403, "Cross-site requests are not allowed");
  const playerId = await sessionPlayerId("prefs");
  if (!playerId) return fail(401, "Sign in required");

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return fail(400, "Invalid JSON body");
  }

  try {
    if ("seen" in body) {
      const seen = body.seen;
      if (!Array.isArray(seen) || seen.length > 100 || !seen.every((s) => typeof s === "string")) {
        return fail(400, "seen must be an array of up to 100 card ids");
      }
      return json({ ok: true, marked: await collectiblesStore.markSeen(playerId, seen as string[]) }, 200);
    }

    const { collectibleId, favourite, featuredPosition } = body;
    if (typeof collectibleId !== "string" || !getCollectible(collectibleId)) return fail(404, "No such card");
    if (favourite !== undefined && typeof favourite !== "boolean") return fail(400, "favourite must be true or false");
    if (
      featuredPosition !== undefined &&
      featuredPosition !== null &&
      !(typeof featuredPosition === "number" && Number.isInteger(featuredPosition) && featuredPosition >= 1 && featuredPosition <= MAX_FEATURED)
    ) {
      return fail(400, `featuredPosition must be 1 to ${MAX_FEATURED}, or null`);
    }
    if (favourite === undefined && featuredPosition === undefined) return fail(400, "Nothing to change");

    const prefs = await collectiblesStore.setPrefs({
      playerId,
      collectibleId,
      favourite: favourite as boolean | undefined,
      featuredPosition: featuredPosition as number | null | undefined,
    });
    if (!prefs) return fail(404, "You do not own that card");
    return json({ ok: true, collectibleId, ...prefs }, 200);
  } catch (error) {
    console.error("collection prefs failed:", error);
    return fail(503, "Temporarily unavailable");
  }
}
