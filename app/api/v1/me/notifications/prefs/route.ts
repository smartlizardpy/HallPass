/**
 * One notification preference — `PUT /api/v1/me/notifications/prefs`.
 *
 * ── THERE IS NO `GET` HERE, DELIBERATELY ───────────────────────────────────
 * `/play/you/notifications` is a server component and reads the resolved
 * preferences directly through `getResolvedPrefs`, so a GET would have no
 * caller. This repo's own note about the unused `gh_*` columns in migration 021
 * is the argument: an endpoint nobody calls is scaffolding that reads as
 * finished, and it would be a second, untested path to the same data.
 *
 * ── ONE KIND PER REQUEST ───────────────────────────────────────────────────
 * The UI is a row of independent toggles and each one saves itself, so a batch
 * body would be an array of length one on every real call — and it would need a
 * partial-failure story ("three saved, one did not") that a single write simply
 * does not have.
 *
 * ── THE AUDIENCE IS CHECKED, NOT ASSUMED ───────────────────────────────────
 * A player cannot store a preference for an admin-only kind. It would be
 * harmless in itself — delivery resolves the admin roster at send time, so a
 * stray row grants nothing — but it would leave a row implying an entitlement
 * that does not exist, and "the client only ever sends kinds it was shown" is
 * exactly the assumption a credentialed endpoint must not make.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { getPlayerById } from "@/app/lib/players";
import { notifications } from "@/app/lib/notifications";
import { audienceFor } from "@/app/lib/notifications/admins";
import {
  isNotificationKind,
  kindsForAudience,
  toChannel,
} from "@/app/lib/notifications/config";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
  forbidden,
  isTrustedOrigin,
  unauthorized,
} from "@/app/lib/social/request-guard";

function badRequest(): Response {
  return Response.json(
    { ok: false, error: "bad-request" },
    { status: 400, headers: NO_STORE },
  );
}

export async function PUT(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest();
  }

  // Both narrowed before anything is read from the database. An unknown kind and
  // an unknown channel are the same class of input — something this deploy has
  // no meaning for — and neither may reach a write.
  const kind = body.kind;
  const channel = toChannel(body.channel);
  if (!isNotificationKind(kind) || !channel) return badRequest();

  try {
    // The audience comes from the player's OWN email via the session, never from
    // the request. `getPlayerById` is the only way to reach it, and a player row
    // that has vanished mid-session resolves to the player audience.
    const player = await getPlayerById(playerId);
    const audience = await audienceFor(player?.email);
    if (!kindsForAudience(audience).includes(kind)) return forbidden();

    await notifications.setPref(playerId, kind, channel);
    return Response.json({ ok: true, kind, channel }, { headers: NO_STORE });
  } catch (error) {
    if (!isMissingColumnError(error)) {
      console.error("me/notifications/prefs PUT failed:", error);
    }
    return Response.json(
      { ok: false, error: "unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("PUT, OPTIONS");
}
