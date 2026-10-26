/**
 * HallPass championship progress — `GET /api/v1/championship/<event>/me`.
 *
 * The signed-in player's own place, points, boards still to enter and recent
 * runs. Per-player, so `private, no-store`, and same-origin only (no CORS).
 * Signed out → `{ signedIn: false }` (200), so the page can offer sign-in
 * without treating it as an error.
 */

import type { ApiError } from "@/sdk/src/contract";
import { auth } from "@/app/lib/auth";
import { championshipById } from "@/app/lib/championship/config";
import { getMyProgress } from "@/app/lib/championship";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ event: string }> },
): Promise<Response> {
  const { event } = await params;
  const c = championshipById(event);
  if (!c || !c.enabled) {
    return Response.json({ error: "No such championship" } satisfies ApiError, { status: 404, headers: NO_STORE });
  }
  let playerId: string | undefined;
  try {
    playerId = (await auth())?.user?.playerId;
  } catch (error) {
    console.error("championship/me auth() failed:", error);
  }
  if (!playerId) return Response.json({ signedIn: false }, { status: 200, headers: NO_STORE });
  const progress = await getMyProgress(c, playerId);
  return Response.json({ signedIn: true, ...progress }, { status: 200, headers: NO_STORE });
}
