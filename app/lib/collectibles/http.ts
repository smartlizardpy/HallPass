/**
 * HallPass — shared bits of the collectibles routes.
 *
 * CREDENTIALED AND SAME-ORIGIN. A player's packs and binder are keyed by the
 * session cookie, so these routes follow `me/claim`: no wildcard CORS (a wildcard
 * cannot carry credentials anyway), `private, no-store`, 401 without a session,
 * and a request whose `Origin` names another site is refused outright on top of
 * the cookie's SameSite protection. The one public route (a player's showcase) is
 * the opposite: the same body for everybody, public names only, CDN-cacheable.
 */

import "server-only";
import { auth } from "@/app/lib/auth";
import type { ApiError } from "@/sdk/src/contract";

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export function json(body: unknown, status: number, headers: Record<string, string> = NO_STORE): Response {
  return Response.json(body, { status, headers });
}

export function fail(status: number, error: string, headers: Record<string, string> = NO_STORE): Response {
  return json({ error } satisfies ApiError, status, headers);
}

/** True when the request comes from another site. No `Origin` header passes to the session check. */
export function crossSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    return true;
  }
}

/** The signed-in player's internal id, or `null` when signed out or auth fails. */
export async function sessionPlayerId(where: string): Promise<string | null> {
  try {
    return (await auth())?.user?.playerId ?? null;
  } catch (error) {
    console.error(`collection ${where}: auth() failed:`, error);
    return null;
  }
}
