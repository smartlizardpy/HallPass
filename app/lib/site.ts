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
 *  2. `VERCEL_URL` — set by the platform to this deployment's own host.
 *  3. Outside production (dev, tests) — the request origin, which is localhost.
 *  4. Otherwise the canonical {@link SITE_URL}.
 */
export function trustedSelfOrigin(requestUrl: string): string {
  const explicit = process.env.SELF_ORIGIN;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  if (process.env.NODE_ENV !== "production") return new URL(requestUrl).origin;
  return SITE_URL;
}
