/**
 * HallPass pack opening — `POST /api/v1/collection/packs/<public id>/open`.
 *
 * Idempotent: the first call rolls and writes the pack's contents; every later
 * call (a refresh, a retry, a second device) returns the stored pulls with
 * `alreadyOpened: true`. Same-origin and credentialed: `401` signed out, `403`
 * for a cross-site Origin, `404` for a pack that is not the caller's, `410` for a
 * revoked one. See `app/lib/collectibles/store.ts` for the atomic step.
 */

import { collectiblesStore } from "@/app/lib/collectibles";
import { crossSite, fail, json, sessionPlayerId } from "@/app/lib/collectibles/http";
import { UUID_RE } from "@/app/lib/collectibles/store";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (crossSite(req)) return fail(403, "Cross-site requests are not allowed");
  const playerId = await sessionPlayerId("open");
  if (!playerId) return fail(401, "Sign in required");
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail(404, "No such pack");

  let result;
  try {
    result = await collectiblesStore.openPack({ playerId, publicId: id });
  } catch (error) {
    console.error("collection open failed:", error);
    return json({ error: "Opening is temporarily unavailable. Nothing was lost: try again." }, 503, { "Cache-Control": "private, no-store", "Retry-After": "5" });
  }
  if (result.status === "not-found") return fail(404, "No such pack");
  if (result.status === "revoked") return fail(410, "This pack is no longer available");
  return json(
    {
      alreadyOpened: result.alreadyOpened,
      pack: { id: result.pack.publicId, packId: result.pack.packId, packVersion: result.pack.packVersion, openedAt: result.pack.openedAt },
      pulls: result.pulls.map((p) => ({ slot: p.slot, collectibleId: p.collectibleId, wasNew: p.wasNew })),
    },
    200,
  );
}
