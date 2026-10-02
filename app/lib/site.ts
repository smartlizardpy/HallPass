/** Canonical origin the site is served from. No trailing slash. */
export const SITE_URL = "https://hallpass-rouge.vercel.app";

/**
 * The origin THIS deployment can safely fetch its own static files from.
 *
 * For server-side fetches that must not be steerable by the caller: the request's
 * own URL is built from the `Host` header, so fetching `new URL(req.url).origin`
 * would let anyone who can set that header aim the server at a host of their
 * choosing. In order of trust:
 *
 *  1. `SELF_ORIGIN` — explicit server configuration (also how a local
 *     `next start` points at itself).
 *  2. PRODUCTION (`VERCEL_ENV === "production"`) — the canonical {@link SITE_URL},
 *     always. NEVER `VERCEL_URL`: that is the per-deployment host, which sits
 *     behind Deployment Protection and answers a 302 to Vercel's login page even
 *     for the production deployment. Not `VERCEL_PROJECT_PRODUCTION_URL` either:
 *     Vercel picks it from the project's production domains, and on 2026-10-03 the
 *     only one of those that served `/games/` unprotected was SITE_URL (the
 *     `-<team>-projects.vercel.app` alias answered 302 too).
 *  3. Preview (`VERCEL_ENV === "preview"`) — `VERCEL_URL`, the only host that
 *     serves that deployment's own files. It may be protected too; callers must
 *     treat a non-200 as "unavailable" (the game route does).
 *  4. Anywhere else, outside production (dev, tests) — the request origin, which
 *     is localhost.
 *  5. Otherwise the canonical {@link SITE_URL}.
 */
export function trustedSelfOrigin(requestUrl: string): string {
  const explicit = process.env.SELF_ORIGIN;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_ENV === "production") return SITE_URL;
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    const host = process.env.VERCEL_URL.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return `https://${host}`;
  }
  if (process.env.NODE_ENV !== "production") return new URL(requestUrl).origin;
  return SITE_URL;
}
