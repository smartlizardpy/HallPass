/**
 * HallPass — naming the player who caused a notification.
 *
 * ── WHY THIS IS NOT `getPublicIdentity` ────────────────────────────────────
 * There is already a "who is this player" read in `players.ts`, and it is the
 * WRONG ONE for this job. `getPublicIdentity` resolves through
 * `effectiveHandle`, which falls back to `players.name` — the Google account
 * name, i.e. most people's REAL NAME. That fallback is correct where it is used,
 * on owner-facing surfaces where the viewer is the person themselves.
 *
 * A notification is the opposite case. "Ayşe wants to be friends" is rendered in
 * somebody ELSE's bell and, if they have push on, on their lock screen — so the
 * Google-name fallback would publish a child's real name to another pupil, and
 * onto a screen anybody in the room can see. `players.ts` states the rule
 * outright: use `publicDisplayName` on anything another player can see, and
 * `effectiveHandle` only where the viewer is the owner.
 *
 * So this module exists to make the safe read the convenient one, and to put the
 * reasoning next to it rather than in a comment at each of the producers. It is
 * the same rule `challenges/store.ts` reproduces inline for the same reason.
 *
 * ── IT DEGRADES TO "Player", NEVER TO A NAME ───────────────────────────────
 * A failed read gives the generic fallback. Every other option is worse: no
 * notification at all for a database blip, or reaching for a field that is the
 * one thing that must not appear here.
 */

import "server-only";
import { sql } from "@/app/lib/db";
import { publicDisplayName } from "@/app/lib/players";

/**
 * The name to show another player for `playerId`: their chosen handle, else
 * `@username`, else `"Player"`.
 *
 * ONE statement — `handle` and `username` are both columns on `players`, so this
 * costs a single round trip on a path that is already writing a row.
 */
export async function publicNameFor(playerId: string): Promise<string> {
  try {
    const rows = (await sql`
      SELECT handle, username FROM players WHERE id = ${playerId}
    `) as Record<string, unknown>[];
    if (rows.length === 0) return "Player";
    return publicDisplayName({
      handle: rows[0].handle == null ? null : String(rows[0].handle),
      username: rows[0].username == null ? null : String(rows[0].username),
    });
  } catch (error) {
    console.error(`[notifications] publicNameFor(${playerId}) failed:`, error);
    return "Player";
  }
}
