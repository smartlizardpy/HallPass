/**
 * HallPass footer-credit visibility — `GET /api/v1/credit-visibility`.
 *
 * `SiteFooter` is composed inside `ArcadeShell`, a client component, which
 * means it (and anything it renders) ships to the client bundle and cannot
 * call `geolocation()` itself — that needs the actual incoming `Request`,
 * which only a Route Handler sees. So the decision is made HERE, server-side,
 * per request, and the client only ever learns the yes/no answer — never the
 * country, which it has no other use for.
 *
 * `Cache-Control: private, no-store` is load-bearing: this answer is a
 * function of the CALLER's IP, so a shared cache serving one visitor's answer
 * to the next visitor would show real names to (or hide them from) the wrong
 * country entirely.
 */

import { geolocation } from "@vercel/functions";
import { shouldShowRealCredits } from "@/app/lib/credit-visibility";

export async function GET(req: Request): Promise<Response> {
  const { country } = geolocation(req);
  return Response.json(
    { showRealCredits: shouldShowRealCredits(country) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
