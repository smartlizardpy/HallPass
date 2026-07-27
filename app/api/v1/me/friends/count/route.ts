/**
 * Friend counts for the header badge — `GET /api/v1/me/friends/count`.
 *
 * Its own endpoint rather than a field on `/api/v1/me`, deliberately.
 * `MeResponse` lives in `sdk/src/contract.ts`, which is the APPEND-ONLY public
 * SDK contract that third-party embedded games consume — adding social data
 * there would ship a player's friend counts into every game's response and grow
 * a bundle that has nothing to do with leaderboards.
 *
 * `AccountMenu` fires this alongside its existing `/api/v1/me` call and must NOT
 * let it gate the `loaded` flag: the avatar should appear as soon as identity
 * lands, with the badge following whenever this does.
 */

import { isMissingColumnError } from "@/app/lib/db";
import { social } from "@/app/lib/social";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
} from "@/app/lib/social/request-guard";

export async function GET(): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) {
    return Response.json(
      { signedIn: false, friends: 0, incoming: 0 },
      { headers: NO_STORE },
    );
  }

  try {
    const counts = await social.counts(playerId);
    return Response.json({ signedIn: true, ...counts }, { headers: NO_STORE });
  } catch (error) {
    // Never surface an error for a badge. A missing table (schema behind the
    // deploy) and a transient blip both read as "no badge".
    if (!isMissingColumnError(error)) {
      console.error("me/friends/count failed:", error);
    }
    return Response.json(
      { signedIn: true, friends: 0, incoming: 0 },
      { headers: NO_STORE },
    );
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("GET, OPTIONS");
}
