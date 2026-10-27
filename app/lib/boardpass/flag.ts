/**
 * BoardPass — the rollout switch and kill switch.
 *
 * `boardpass:mode` in `app_settings`:
 *   off    nothing works; every BoardPass route answers 404 (the default)
 *   staff  only dashboard users and beta testers can set or use a PIN
 *   on     everyone
 *
 * An unset, unreadable or unrecognised value is `off`: a settings read that fails
 * must never switch authentication on. Turning it `off` stops NEW sign-ins and
 * ends no one's Google session; board sessions already open stop resolving too,
 * because the resolver checks the mode before it looks at a cookie.
 */

import "server-only";
import { getSessionRole } from "@/app/lib/dashboard-users";
import { isBetaTester } from "@/app/lib/beta";
import { sql } from "@/app/lib/db";
import type { BoardPassMode } from "./config";
import { getBoardPassMode, parseMode } from "./mode";

export { getBoardPassMode, parseMode };

/** A dashboard user or a beta tester. Fail-soft to false. */
export async function isStaffPlayer(playerId: string): Promise<boolean> {
  try {
    if (await isBetaTester(playerId)) return true;
    const rows = (await sql`SELECT email FROM players WHERE id = ${playerId}`) as {
      email: string;
    }[];
    const email = rows[0]?.email;
    return email ? (await getSessionRole(email)) !== null : false;
  } catch {
    return false;
  }
}

/** Pure rule: does this mode let this player in? */
export function modeAllows(mode: BoardPassMode, isStaff: boolean): boolean {
  return mode === "on" || (mode === "staff" && isStaff);
}

/** Convenience: resolve the mode and the staff check together. */
export async function boardPassAllowedFor(playerId: string): Promise<boolean> {
  const mode = await getBoardPassMode();
  if (mode === "off") return false;
  if (mode === "on") return true;
  return modeAllows(mode, await isStaffPlayer(playerId));
}
