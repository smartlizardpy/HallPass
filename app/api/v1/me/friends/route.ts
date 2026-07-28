/**
 * HallPass friends endpoint — `GET|POST|PUT|DELETE|OPTIONS /api/v1/me/friends`.
 *
 * Mirrors `/api/v1/me/favorites` in shape and discipline: cookie-credentialed,
 * same-origin only, `private, no-store`, no wildcard CORS header (a wildcard
 * origin cannot legally carry credentials), and the acting player derived
 * ENTIRELY from the session — never from the body.
 *
 * IDS ON THE WIRE ARE `public_id` UUIDs, never `players.id`. The internal id is
 * the Google subject: a stable cross-service correlation identifier, and this
 * endpoint returns OTHER PEOPLE's identities, so shipping it would publish a
 * durable tracking id for a minor to anyone who can read the response.
 *
 * Methods:
 *   GET    → { signedIn, enabled, friends, incoming, outgoing }
 *   POST   { username } | { friendCode } | { id } → { ok, state }  send a request
 *   PUT    { id }  → accept a pending request
 *   DELETE { id }  → decline / cancel / unfriend (one unconditional verb)
 *
 * GRACEFUL WHEN THE SCHEMA IS BEHIND. Migrations here are applied by hand, so
 * there is always a window where this code is live against a database without
 * `friendships`. `isMissingColumnError` turns that into `enabled: false` — the UI
 * hides the friends surfaces — instead of a 500 on a page every visitor loads.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { social } from "@/app/lib/social";
import type { SendResult } from "@/app/lib/social";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
  forbidden,
  isTrustedOrigin,
  unauthorized,
} from "@/app/lib/social/request-guard";
import {
  isValidFriendCode,
  normalizeFriendCode,
  normalizeUsername,
} from "@/app/lib/username";

/** HTTP status per send outcome. All of them are "handled", none are 500s. */
const SEND_STATUS: Record<SendResult, number> = {
  sent: 200,
  accepted: 200,
  already: 200,
  cooldown: 429,
  "rate-limited": 429,
  "at-capacity": 409,
  unavailable: 404,
};

export async function GET(): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) {
    return Response.json(
      { signedIn: false, enabled: true, friends: [], incoming: [], outgoing: [] },
      { headers: NO_STORE },
    );
  }

  try {
    const [friends, incoming, outgoing] = await Promise.all([
      social.listFriends(playerId),
      social.listIncomingRequests(playerId),
      social.listOutgoingRequests(playerId),
    ]);
    return Response.json(
      { signedIn: true, enabled: true, friends, incoming, outgoing },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (isMissingColumnError(error)) {
      // Schema not applied yet: report the feature as unavailable rather than
      // erroring a surface the account menu polls on every page.
      return Response.json(
        { signedIn: true, enabled: false, friends: [], incoming: [], outgoing: [] },
        { headers: NO_STORE },
      );
    }
    console.error("me/friends GET failed:", error);
    return Response.json(
      { signedIn: true, enabled: false, friends: [], incoming: [], outgoing: [] },
      { headers: NO_STORE },
    );
  }
}

/**
 * Resolve whichever identifier the client sent to an internal player id.
 *
 * Returns `null` for "no such player" AND for a malformed identifier, and the
 * caller collapses that into the same `unavailable` answer a BLOCKED target gets.
 * Distinguishing them would make this endpoint a username-existence oracle that
 * bypasses the search endpoint's rate limit entirely.
 */
async function resolveTarget(body: {
  username?: unknown;
  friendCode?: unknown;
  id?: unknown;
}): Promise<string | null> {
  if (typeof body.id === "string" && body.id.length > 0) {
    return social.internalIdFromPublicId(body.id);
  }
  if (typeof body.username === "string" && body.username.length > 0) {
    return social.internalIdFromUsername(normalizeUsername(body.username));
  }
  if (typeof body.friendCode === "string" && body.friendCode.length > 0) {
    const code = normalizeFriendCode(body.friendCode);
    // A malformed code must still consume the caller's rate budget upstream —
    // otherwise the 2.8e11 code space is free to brute-force, since a miss would
    // cost nothing.
    if (!isValidFriendCode(code)) return null;
    return social.internalIdFromFriendCode(code);
  }
  return null;
}

export async function POST(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, state: "unavailable" }, { status: 400, headers: NO_STORE });
  }

  try {
    const target = await resolveTarget(body);
    // Self-request and unknown target are both "unavailable" — no information.
    if (!target || target === playerId) {
      return Response.json(
        { ok: false, state: "unavailable" },
        { status: 404, headers: NO_STORE },
      );
    }

    const state = await social.sendRequest(playerId, target);
    return Response.json(
      { ok: state === "sent" || state === "accepted", state },
      { status: SEND_STATUS[state], headers: NO_STORE },
    );
  } catch (error) {
    if (isMissingColumnError(error)) {
      return Response.json({ ok: false, state: "unavailable" }, { status: 503, headers: NO_STORE });
    }
    console.error("me/friends POST failed:", error);
    return Response.json({ ok: false, state: "unavailable" }, { status: 500, headers: NO_STORE });
  }
}

export async function PUT(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  let publicId = "";
  try {
    const body = (await req.json()) as { id?: unknown };
    publicId = typeof body?.id === "string" ? body.id : "";
  } catch {
    publicId = "";
  }
  if (!publicId) {
    return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  }

  try {
    const target = await social.internalIdFromPublicId(publicId);
    if (!target) return Response.json({ ok: false }, { status: 404, headers: NO_STORE });
    const accepted = await social.acceptRequest(playerId, target);
    // `false` means no pending request from THAT player — reported plainly, not
    // as an error, since the client's view may simply be stale.
    return Response.json({ ok: accepted }, { headers: NO_STORE });
  } catch (error) {
    if (isMissingColumnError(error)) {
      return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
    }
    console.error("me/friends PUT failed:", error);
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}

/**
 * Remove any relationship: decline, cancel, or unfriend.
 *
 * ALWAYS reports `{ ok: true }`, including when nothing matched. A 404 here would
 * tell the caller whether a relationship existed — information about a resource
 * they may not be entitled to know about — and the client's intent ("I don't want
 * this relationship") is satisfied either way.
 */
export async function DELETE(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  let publicId = "";
  try {
    const body = (await req.json()) as { id?: unknown };
    publicId = typeof body?.id === "string" ? body.id : "";
  } catch {
    publicId = "";
  }
  if (!publicId) {
    return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  }

  try {
    const target = await social.internalIdFromPublicId(publicId);
    if (target) await social.removeRelationship(playerId, target);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (isMissingColumnError(error)) {
      return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
    }
    console.error("me/friends DELETE failed:", error);
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("GET, POST, PUT, DELETE, OPTIONS");
}
