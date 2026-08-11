/**
 * Mark the inbox read — `POST /api/v1/me/notifications/seen`.
 *
 * ── ITS OWN ROUTE, NOT A POST TO THE COLLECTION ────────────────────────────
 * A POST to `/notifications` would read as "create a notification", which is the
 * one thing no client may ever do — every notification is written by a producer
 * on the server, behind an event that actually happened. Naming the sub-resource
 * makes the endpoint say what it does and leaves no method on the collection for
 * somebody to later mistake for a create.
 *
 * ── IT TAKES NO BODY ───────────────────────────────────────────────────────
 * Read state is a single watermark per player (see `024_notifications.sql`), so
 * there is nothing to name: the only operation is "everything up to now". A body
 * carrying a notification id would imply a per-row read state the schema
 * deliberately does not have.
 *
 * ── THE STAMP IS `now()`, TAKEN SERVER-SIDE ────────────────────────────────
 * Not a timestamp from the client, which would let a caller mark themselves read
 * into the future and permanently silence their own bell. The store writes
 * `now()` in SQL; nothing about the clock travels over the wire.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { notifications } from "@/app/lib/notifications";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
  forbidden,
  isTrustedOrigin,
  unauthorized,
} from "@/app/lib/social/request-guard";

export async function POST(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  // A mutation, so it carries the same referrer allow-list every other
  // credentialed write does — a game running in a same-origin iframe must not be
  // able to clear somebody's bell.
  if (!isTrustedOrigin(req)) return forbidden();

  try {
    await notifications.markSeen(playerId);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    // The window before migration 024 is applied is expected and quiet;
    // anything else is a real fault and is logged.
    if (!isMissingColumnError(error)) {
      console.error("me/notifications/seen POST failed:", error);
    }
    return Response.json(
      { ok: false, error: "unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("POST, OPTIONS");
}
