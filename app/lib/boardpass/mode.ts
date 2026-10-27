/**
 * BoardPass — reading the rollout mode, and nothing else.
 *
 * Split out of `flag.ts` on purpose: the gameplay routes (scores, achievements,
 * `/api/v1/me`) import the resolver, and the resolver needs only the mode. The
 * staff check in `flag.ts` pulls in the beta and dashboard-user modules (and with
 * them Auth.js), which a hot gameplay route must not inherit.
 */

import "server-only";
import { readAppSetting } from "@/app/lib/app-settings";
import { BOARDPASS_MODES, BOARDPASS_MODE_KEY, type BoardPassMode } from "./config";

export function parseMode(raw: string | null | undefined): BoardPassMode {
  return (BOARDPASS_MODES as readonly string[]).includes(raw ?? "")
    ? (raw as BoardPassMode)
    : "off";
}

/** An unset, unreadable or unrecognised value is `off`. */
export async function getBoardPassMode(): Promise<BoardPassMode> {
  try {
    return parseMode(await readAppSetting(BOARDPASS_MODE_KEY));
  } catch {
    return "off";
  }
}
