/**
 * HallPass — country detection for the signed-in-user analytics feature.
 *
 * Resolves the ISO 3166-1 alpha-2 country of the CURRENT request from Vercel's
 * `x-vercel-ip-country` edge header, the same source `credit-visibility.ts`
 * reads via `@vercel/functions`'s `geolocation()`. That helper normally takes
 * the raw `Request`, which Auth.js v5's `signIn` callback (this module's one
 * caller) never receives — but `headers()` from `next/headers` reads the SAME
 * incoming request's headers out of Next's request-scoped store, so handing
 * `geolocation()` a `{ headers }` shape gets it the identical data a real
 * `Request` would.
 *
 * Country only: nothing here ever reads city, region, postcode or coordinates,
 * even though the same header set carries them — this feature has no use for
 * anything finer-grained than a country code.
 */

import "server-only";
import { headers } from "next/headers";
import { geolocation } from "@vercel/functions";

const ISO_3166_ALPHA2 = /^[A-Z]{2}$/;

/**
 * The ISO 3166-1 alpha-2 country of the current request, or `null` when
 * Vercel could not place it (local dev, a self-hosted deploy, a proxy with no
 * geo headers) or returned something that is not a plausible 2-letter code.
 * Never throws — a request nobody can place is stored as unknown, never a
 * guess, and must not fail the sign-in that calls it.
 */
export async function detectSignupCountry(): Promise<string | null> {
  const { country } = geolocation({ headers: await headers() });
  if (!country) return null;
  const code = country.toUpperCase();
  return ISO_3166_ALPHA2.test(code) ? code : null;
}
