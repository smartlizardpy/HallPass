/**
 * Reading the dashboard switch for the games' Halloween, and nothing else.
 * Split from `game-event.ts` so that file stays pure (and testable without a
 * database), the way `boardpass/mode.ts` is split from its config.
 */

import "server-only";
import { readAppSetting } from "@/app/lib/app-settings";
import { GAME_EVENT_MODE_KEY, parseGameEventMode, type GameEventMode } from "./game-event";

/** Fail-soft to `auto`: an unreadable setting must not switch the event off by accident. */
export async function getGameEventMode(): Promise<GameEventMode> {
  try {
    return parseGameEventMode(await readAppSetting(GAME_EVENT_MODE_KEY));
  } catch {
    return "auto";
  }
}
