/**
 * Server actions for the BoardPass card on `/play/you/settings`.
 *
 * Identity comes from `auth()` ONLY, never the caller. Every change needs a
 * FULL Google session AND a recent Google sign-in (`authAt`, see
 * `app/lib/boardpass/recent-auth.ts`): a classmate who finds an unlocked laptop
 * must not be able to set a PIN of their own. Results are fixed codes, never
 * free text. Next checks the Origin header on server actions itself.
 */

"use server";

import { auth, signIn } from "@/app/lib/auth";
import { sql } from "@/app/lib/db";
import { boardPassAllowedFor, getBoardPassMode } from "@/app/lib/boardpass/flag";
import {
  deleteCredential,
  revokeParticipantsForPlayer,
  setCredential,
} from "@/app/lib/boardpass/credentials";
import {
  hashPin,
  isPinConfigured,
  isValidPinFormat,
  isWeakPin,
  PinUnavailableError,
} from "@/app/lib/boardpass/pin";
import { isRecentAuth } from "@/app/lib/boardpass/recent-auth";

export type BoardPassActionResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "signed-out"
        | "unavailable"
        | "reauth"
        | "no-username"
        | "invalid-pin"
        | "weak-pin"
        | "mismatch"
        | "failed";
    };

type Gate = { playerId: string } | { fail: BoardPassActionResult };

async function gate(): Promise<Gate> {
  const session = await auth();
  const playerId = session?.user?.playerId;
  if (!playerId) return { fail: { ok: false, error: "signed-out" } };
  if ((await getBoardPassMode()) === "off" || !isPinConfigured()) {
    return { fail: { ok: false, error: "unavailable" } };
  }
  if (!(await boardPassAllowedFor(playerId))) {
    return { fail: { ok: false, error: "unavailable" } };
  }
  if (!isRecentAuth(session?.user?.authAt)) return { fail: { ok: false, error: "reauth" } };
  return { playerId };
}

/** Create or change the PIN. `pin` and `confirm` are both six digits. */
export async function saveBoardPassPin(pin: string, confirm: string): Promise<BoardPassActionResult> {
  const g = await gate();
  if ("fail" in g) return g.fail;
  if (!isValidPinFormat(pin) || !isValidPinFormat(confirm)) return { ok: false, error: "invalid-pin" };
  if (pin !== confirm) return { ok: false, error: "mismatch" };
  if (isWeakPin(pin)) return { ok: false, error: "weak-pin" };
  try {
    const rows = (await sql`SELECT username FROM players WHERE id = ${g.playerId}`) as {
      username: string | null;
    }[];
    if (!rows[0]?.username) return { ok: false, error: "no-username" };
    await setCredential(g.playerId, await hashPin(g.playerId, pin));
    return { ok: true };
  } catch (error) {
    if (error instanceof PinUnavailableError) return { ok: false, error: "unavailable" };
    console.error("boardpass save failed:", error);
    return { ok: false, error: "failed" };
  }
}

export async function disableBoardPass(): Promise<BoardPassActionResult> {
  const g = await gate();
  if ("fail" in g) return g.fail;
  try {
    await deleteCredential(g.playerId);
    return { ok: true };
  } catch (error) {
    console.error("boardpass disable failed:", error);
    return { ok: false, error: "failed" };
  }
}

export async function signOutAllBoards(): Promise<BoardPassActionResult> {
  const g = await gate();
  if ("fail" in g) return g.fail;
  try {
    await revokeParticipantsForPlayer(g.playerId);
    return { ok: true };
  } catch (error) {
    console.error("boardpass revoke failed:", error);
    return { ok: false, error: "failed" };
  }
}

/** "Confirm it's you": a fresh Google round trip, back to settings. */
export async function reauthForBoardPass(): Promise<void> {
  await signIn("google", { redirectTo: "/play/you/settings" });
}
