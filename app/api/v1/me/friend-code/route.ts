/**
 * Friend code — `GET|POST|OPTIONS /api/v1/me/friend-code`.
 *
 * GET  → the caller's code, generating one lazily if they have none.
 * POST → rotate it.
 *
 * GENERATION IS LAZY, AND NEVER HAPPENS AT LOGIN. Putting it in
 * `upsertPlayerOnLogin` is the obvious place and is a trap: in Auth.js v5 a
 * throwing `signIn` callback surfaces as `AccessDenied`, so a collision-retry
 * loop on the login hot path is a way to lock people out of the entire site over
 * a telemetry column. Minting it on first read costs nothing and cannot break
 * sign-in.
 *
 * ROTATION HAS NO HISTORY TABLE, on purpose. The old code dies instantly — which
 * is exactly what a player who posted theirs publicly and started getting spammed
 * needs. Keeping old codes alive "briefly" would defeat the feature.
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
import {
  FRIEND_CODE_ALPHABET,
  FRIEND_CODE_LENGTH,
  formatFriendCode,
  isUnfortunateFriendCode,
} from "@/app/lib/username";

/** How many times to retry on a unique collision or an unfortunate code. */
const MAX_GENERATION_ATTEMPTS = 8;

/**
 * A random code from the confusable-free alphabet.
 *
 * `crypto.getRandomValues` with rejection-free modulo is fine here: the alphabet
 * is 27 symbols and the bias from `% 27` over a byte is negligible for a value
 * whose only job is to be hard to guess in a 2.8e11 space, and which is
 * additionally rate-limited on lookup.
 */
function generateFriendCode(): string {
  const bytes = new Uint8Array(FRIEND_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += FRIEND_CODE_ALPHABET[byte % FRIEND_CODE_ALPHABET.length];
  }
  return code;
}

/** Generate, skipping anything that reads badly. */
function generateAcceptableCode(): string {
  for (let i = 0; i < MAX_GENERATION_ATTEMPTS; i += 1) {
    const code = generateFriendCode();
    if (!isUnfortunateFriendCode(code)) return code;
  }
  // Exhausting the attempts is vanishingly unlikely; returning the last one is
  // better than failing the request.
  return generateFriendCode();
}

export async function GET(): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();

  try {
    const own = await social.getOwnSocial(playerId);
    if (own?.friendCode) {
      return Response.json(
        { code: own.friendCode, display: formatFriendCode(own.friendCode) },
        { headers: NO_STORE },
      );
    }

    // Lazily mint one. `setFriendCodeIfAbsent` is guarded on `friend_code IS
    // NULL`, so if two tabs race, the loser gets zero rows and re-reads rather
    // than overwriting a code the player may already have shared.
    for (let i = 0; i < MAX_GENERATION_ATTEMPTS; i += 1) {
      try {
        const stored = await social.setFriendCodeIfAbsent(playerId, generateAcceptableCode());
        if (stored) {
          return Response.json(
            { code: stored, display: formatFriendCode(stored) },
            { headers: NO_STORE },
          );
        }
        // Zero rows: someone else set it first. Re-read and return theirs.
        const again = await social.getOwnSocial(playerId);
        if (again?.friendCode) {
          return Response.json(
            { code: again.friendCode, display: formatFriendCode(again.friendCode) },
            { headers: NO_STORE },
          );
        }
      } catch (error) {
        // A unique violation means the generated code collided with another
        // player's — retry with a fresh one. Anything else is real.
        const code = (error as { code?: unknown })?.code;
        if (code !== "23505") throw error;
      }
    }
    return Response.json({ code: null }, { status: 503, headers: NO_STORE });
  } catch (error) {
    if (isMissingColumnError(error)) {
      return Response.json({ code: null }, { status: 503, headers: NO_STORE });
    }
    console.error("me/friend-code GET failed:", error);
    return Response.json({ code: null }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) return unauthorized();
  if (!isTrustedOrigin(req)) return forbidden();

  try {
    for (let i = 0; i < MAX_GENERATION_ATTEMPTS; i += 1) {
      const code = generateAcceptableCode();
      try {
        await social.rotateFriendCode(playerId, code);
        return Response.json(
          { code, display: formatFriendCode(code) },
          { headers: NO_STORE },
        );
      } catch (error) {
        const pgCode = (error as { code?: unknown })?.code;
        if (pgCode !== "23505") throw error;
      }
    }
    return Response.json({ code: null }, { status: 503, headers: NO_STORE });
  } catch (error) {
    if (isMissingColumnError(error)) {
      return Response.json({ code: null }, { status: 503, headers: NO_STORE });
    }
    console.error("me/friend-code POST failed:", error);
    return Response.json({ code: null }, { status: 500, headers: NO_STORE });
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("GET, POST, OPTIONS");
}
