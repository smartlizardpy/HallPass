/**
 * HallPass championship standings — `GET /api/v1/championship/<event>`.
 *
 * The public table: phase, every board's top entries and the overall Fright
 * Points table. Public ids and public names only (`toPublicStandings` strips
 * internal ids). The same for everybody, so the CDN holds it for 30 seconds;
 * pages read it from the client (never under a prerendered page, see incident
 * #131). After finalisation it is the frozen official result.
 */

import type { ApiError } from "@/sdk/src/contract";
import { championshipById } from "@/app/lib/championship/config";
import { getPublicChampionship } from "@/app/lib/championship";

const CACHE = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ event: string }> },
): Promise<Response> {
  const { event } = await params;
  const c = championshipById(event);
  if (!c || !c.enabled) {
    return Response.json({ error: "No such championship" } satisfies ApiError, { status: 404, headers: CACHE });
  }
  const pub = await getPublicChampionship(c);
  // An unavailable store is a short, uncached answer so it clears as soon as the store is back.
  return Response.json(pub, {
    status: 200,
    headers: pub.available ? CACHE : { "Cache-Control": "public, s-maxage=5" },
  });
}
