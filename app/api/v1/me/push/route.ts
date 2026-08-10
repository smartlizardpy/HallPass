/**
 * Push subscriptions for the signed-in player — `/api/v1/me/push`.
 *
 * ── GET ALSO SERVES THE VAPID PUBLIC KEY ───────────────────────────────────
 * `pushManager.subscribe()` needs it, and it is a public value — but it is
 * served here at REQUEST time rather than inlined as `NEXT_PUBLIC_*`. That
 * matters in this repo specifically: `NEXT_PUBLIC_*` is baked in at BUILD time,
 * and `scripts/check-build-env.mjs` exists because a missing build-time PostHog
 * token once shipped a build that silently captured nothing. Serving it from a
 * route means adding the env var takes effect on the next request, and a missing
 * one reads honestly as `configured: false` instead of a build that quietly
 * never notifies anybody.
 *
 * ── THE PLAYER IS THE COOKIE ───────────────────────────────────────────────
 * A subscription is attached to the session's player, never to an id in the
 * body, so one account cannot register a device against another.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { push } from "@/app/lib/push";
import {
  isAllowedPushEndpoint,
  isPushConfigured,
  vapidConfig,
} from "@/app/lib/push/config";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
  forbidden,
  isTrustedOrigin,
  unauthorized,
} from "@/app/lib/social/request-guard";

/**
 * Whether push can be offered, and the key needed to accept.
 *
 * Answers for a signed-out visitor too — the promo needs to know whether to
 * appear at all, and the public key is not a secret.
 */
export async function GET(): Promise<Response> {
  return Response.json(
    {
      configured: isPushConfigured(),
      publicKey: isPushConfigured() ? vapidConfig().publicKey : null,
    },
    { headers: NO_STORE },
  );
}

/** Read the three fields a `PushSubscription` must carry, or `null`. */
function readSubscription(
  body: Record<string, unknown>,
): { endpoint: string; p256dh: string; auth: string } | null {
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const keys = (body.keys ?? {}) as Record<string, unknown>;
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";
  // All three are required: a row missing a key could only ever carry a
  // contentless push, which this feature has no use for.
  if (!endpoint || !p256dh || !auth) return null;
  // An https check alone is not enough: the server later POSTs to whatever is
  // stored here, so accepting any host would make this a request-forgery
  // primitive. Only known push services are allowed.
  if (!isAllowedPushEndpoint(endpoint)) return null;
  return { endpoint, p256dh, auth };
}

export async function POST(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();
  if (!isPushConfigured()) {
    // Honest rather than a silent success: the client should not show a player
    // that notifications are on when nothing can ever be sent.
    return Response.json(
      { ok: false, error: "unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad-request" }, { status: 400, headers: NO_STORE });
  }

  const subscription = readSubscription(body);
  if (!subscription) {
    return Response.json({ ok: false, error: "bad-request" }, { status: 400, headers: NO_STORE });
  }

  try {
    await push.subscribe({ playerId, ...subscription });
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (!isMissingColumnError(error)) {
      console.error("me/push POST failed:", error);
    }
    return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  let endpoint = "";
  try {
    const body = (await req.json()) as { endpoint?: unknown };
    endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  } catch {
    return Response.json({ ok: false, error: "bad-request" }, { status: 400, headers: NO_STORE });
  }
  if (!endpoint) {
    return Response.json({ ok: false, error: "bad-request" }, { status: 400, headers: NO_STORE });
  }

  try {
    // Keyed on the player as well as the endpoint, so a leaked endpoint cannot
    // be used to silence somebody else's device.
    const removed = await push.unsubscribe(playerId, endpoint);
    return Response.json({ ok: true, removed }, { headers: NO_STORE });
  } catch (error) {
    if (!isMissingColumnError(error)) {
      console.error("me/push DELETE failed:", error);
    }
    return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("GET, POST, DELETE, OPTIONS");
}
