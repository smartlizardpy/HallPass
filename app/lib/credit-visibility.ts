/**
 * HallPass — who the public footer says built the site.
 *
 * `SiteFooter` names the two people behind HallPass to visitors it geolocates to
 * the UK or Turkey, and a generic studio name to everyone else — the two
 * countries the team is actually reachable from, versus the rest of the
 * internet a stranger's real name buys nothing by being handed to.
 *
 * Pure and side-effect-free (bar the one `process.env` read), same shape as
 * `beta/config.ts`: no `server-only`, so it can be imported from the route
 * handler that resolves a visitor's country AND from a test with no
 * geolocation to fake.
 */

/** ISO 3166-1 alpha-2, matching what `@vercel/functions`'s `geolocation()` returns. */
export const CREDIT_VISIBLE_COUNTRIES = ["GB", "TR"] as const;

/** What non-UK/Turkey visitors see instead of the real names. */
export const CREDIT_PLACEHOLDER = "Sigma Alpha Male Game Studios";

/**
 * The gate defaults ON. Set `CREDIT_GEO_GATE=off` (or `0`/`false`/`no`) to turn
 * it off and show the real names to everybody, same as before this feature
 * existed — an explicit opt-out rather than an opt-in, so a fresh deploy with
 * the var unset gets the geo gate rather than silently leaking real names.
 */
export function isCreditGeoGateEnabled(): boolean {
  const raw = process.env.CREDIT_GEO_GATE?.trim().toLowerCase();
  return raw !== "off" && raw !== "0" && raw !== "false" && raw !== "no";
}

/**
 * Should this visitor see the real names?
 *
 * `country` is whatever `geolocation()` resolved — `null`/`undefined` when
 * Vercel could not place the request (local dev, a self-hosted deploy, a proxy
 * with no geo headers). Unknown fails CLOSED: the whole point of the gate is
 * to keep real names off the general internet, so a request nobody can place
 * gets the placeholder, not the benefit of the doubt.
 */
export function shouldShowRealCredits(country: string | null | undefined): boolean {
  if (!isCreditGeoGateEnabled()) return true;
  if (!country) return false;
  return (CREDIT_VISIBLE_COUNTRIES as readonly string[]).includes(
    country.toUpperCase(),
  );
}
