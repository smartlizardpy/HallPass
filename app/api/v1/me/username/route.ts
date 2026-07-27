/**
 * Username availability + claim — `GET|POST|OPTIONS /api/v1/me/username`.
 *
 * GET  ?check=<name> → { available, reason? }   advisory only
 * POST { username }  → { ok, username } | { ok:false, reason }
 *
 * THE AVAILABILITY CHECK IS ADVISORY, AND THAT IS NOT A WEAKNESS TO FIX. Any
 * check-then-claim has a race; the only correct resolution is the UNIQUE
 * constraint on `players.username`, whose violation the POST maps to "taken". The
 * GET exists to give useful feedback while typing, not to reserve anything.
 *
 * Slur checking happens ONLY on POST. `username-wordlist.ts` is server-only
 * precisely so it is not shipped to browsers, and running it on the GET would let
 * anyone binary-search the list through the availability endpoint — which is the
 * same leak by a slower route.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { social } from "@/app/lib/social";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
  forbidden,
  isTrustedOrigin,
  unauthorized,
} from "@/app/lib/social/request-guard";
import { USERNAME_RENAME_COOLDOWN_DAYS } from "@/app/lib/social/config";
import {
  USERNAME_REJECTION_MESSAGES,
  validateUsernameFormat,
} from "@/app/lib/username";
import { containsBlockedTerm } from "@/app/lib/username-wordlist";

/** Postgres unique_violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

export async function GET(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();

  const candidate = new URL(req.url).searchParams.get("check") ?? "";
  const format = validateUsernameFormat(candidate);
  if (!format.ok) {
    return Response.json(
      { available: false, reason: USERNAME_REJECTION_MESSAGES[format.reason] },
      { headers: NO_STORE },
    );
  }

  try {
    const taken = await social.internalIdFromUsername(format.username);
    return Response.json(
      {
        available: taken === null || taken === playerId,
        // Same copy as the reserved case: an availability endpoint should not
        // confirm that a specific name belongs to a specific person.
        reason: taken && taken !== playerId ? "That username isn't available" : undefined,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (!isMissingColumnError(error)) {
      console.error("me/username GET failed:", error);
    }
    return Response.json({ available: false }, { headers: NO_STORE });
  }
}

export async function POST(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  let raw = "";
  try {
    const body = (await req.json()) as { username?: unknown };
    raw = typeof body?.username === "string" ? body.username : "";
  } catch {
    raw = "";
  }

  const format = validateUsernameFormat(raw);
  if (!format.ok) {
    return Response.json(
      { ok: false, reason: USERNAME_REJECTION_MESSAGES[format.reason] },
      { status: 400, headers: NO_STORE },
    );
  }
  if (containsBlockedTerm(format.username)) {
    // Same copy as "reserved", so the response does not confirm which list matched.
    return Response.json(
      { ok: false, reason: "That username isn't available" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const result = await social.claimUsername(playerId, format.username);
    if (result.claimed) {
      return Response.json({ ok: true, username: format.username }, { headers: NO_STORE });
    }
    if (result.tombstoned) {
      return Response.json(
        { ok: false, reason: "That username was recently released and is on hold" },
        { status: 409, headers: NO_STORE },
      );
    }
    if (result.plays === 0) {
      // Anti-squatting: a real player has a play row by construction, having
      // arrived from a game. A farm of throwaway accounts has to simulate
      // gameplay per account, which is the point.
      return Response.json(
        { ok: false, reason: "Play a game first, then pick your username" },
        { status: 409, headers: NO_STORE },
      );
    }
    return Response.json(
      {
        ok: false,
        reason: `You can change your username once every ${USERNAME_RENAME_COOLDOWN_DAYS} days`,
      },
      { status: 409, headers: NO_STORE },
    );
  } catch (error) {
    // The ONLY correct resolution of the check-then-claim race.
    if (isUniqueViolation(error)) {
      return Response.json(
        { ok: false, reason: "That username isn't available" },
        { status: 409, headers: NO_STORE },
      );
    }
    if (isMissingColumnError(error)) {
      return Response.json(
        { ok: false, reason: "Usernames aren't available yet" },
        { status: 503, headers: NO_STORE },
      );
    }
    console.error("me/username POST failed:", error);
    return Response.json(
      { ok: false, reason: "Could not save that username" },
      { status: 500, headers: NO_STORE },
    );
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("GET, POST, OPTIONS");
}
