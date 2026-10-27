/**
 * BoardPass — shared request guards for `/api/v1/boardpass/*`.
 *
 * Every route here is same-origin, JSON, and `private, no-store`. State-changing
 * calls also pass the site's referrer allowlist (`isTrustedOrigin`, which now
 * includes `/board`) and must carry `Content-Type: application/json`, which a
 * cross-site form cannot send without a CORS preflight — and no CORS headers are
 * ever returned. Together with `SameSite=Lax` on the cookie, that closes
 * cross-site request forgery. It does NOT stop a hostile game running on our own
 * origin from forging a referrer; that limit is the one documented in
 * `app/lib/social/origin.ts`, and is why PIN entry exists only in the lobby.
 */

import { isTrustedOrigin } from "@/app/lib/social/origin";
import { getBoardPassMode } from "./mode";
import { isPinConfigured } from "./pin";

export const NO_STORE: Record<string, string> = { "Cache-Control": "private, no-store" };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export const notFound = (): Response => json({ ok: false, error: "not-found" }, 404);
export const forbidden = (): Response => json({ ok: false, error: "forbidden" }, 403);
export const unavailable = (): Response => json({ ok: false, error: "unavailable" }, 503);

/**
 * Gate for state-changing routes. Returns the response to send, or `null` to carry
 * on. Order matters: the mode first (an `off` board answers 404 to everything, so
 * it cannot be probed), then the origin, then the content type.
 */
export async function guardWrite(req: Request): Promise<Response | null> {
  if ((await getBoardPassMode()) === "off") return notFound();
  if (!isTrustedOrigin(req)) return forbidden();
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    return json({ ok: false, error: "unsupported-media-type" }, 415);
  }
  if (!isPinConfigured()) return unavailable();
  return null;
}

/** Parse a JSON object body; `null` if it isn't one. */
export async function readObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
