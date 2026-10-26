/**
 * HallPass showcase — `GET /api/v1/collection/showcase/<username>`.
 *
 * PUBLIC. A player's featured cards, only when their profile is public; otherwise
 * `404`, indistinguishable from "no such player". Public name and avatar only,
 * never a Google name, email or photo. The same body for everybody, so it is
 * CDN-cacheable; `Access-Control-Allow-Origin: *` is safe because the response
 * carries no credentials-dependent data.
 */

import { getShowcase } from "@/app/lib/collectibles";
import { fail, json } from "@/app/lib/collectibles/http";

const USERNAME_RE = /^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$/;
const PUBLIC = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300", "Access-Control-Allow-Origin": "*" };
const MISS = { "Cache-Control": "public, s-maxage=30", "Access-Control-Allow-Origin": "*" };

export async function GET(_req: Request, { params }: { params: Promise<{ username: string }> }): Promise<Response> {
  const { username } = await params;
  const name = username.toLowerCase();
  if (!USERNAME_RE.test(name)) return fail(404, "No such player", MISS);
  const showcase = await getShowcase(name);
  if (!showcase.available) return fail(503, "Showcase temporarily unavailable", { "Cache-Control": "no-store", "Retry-After": "10" });
  if (!showcase.player) return fail(404, "No such player", MISS);
  return json({ player: showcase.player, featured: showcase.featured }, 200, PUBLIC);
}
