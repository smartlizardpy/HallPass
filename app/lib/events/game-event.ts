/**
 * HallPass — what a GAME is told about the seasonal event. Pure data, no
 * `window`, no database: `game-event-mode.ts` reads the dashboard switch and
 * `GET /api/v1/event` glues the two together.
 *
 * ONE QUESTION, ONE ANSWER. A game asks "is Halloween on right now?" and gets a
 * boolean it can trust: `active`. It never does date maths, never has its own
 * copy of the window, and never decides for itself. When `active` is `false` the
 * event DOES NOT EXIST as far as the game is concerned: `event` is `null` and so
 * are the dates, so a game that keyed on any of them sees nothing to show.
 *
 * TWO SWITCHES, BOTH OF WHICH WIN OVER THE CLOCK:
 *  - the dashboard mode (`off` below), flipped with no deploy;
 *  - `enabled: false` in `fright-fest.ts`, which is what the site's own skin
 *    reads too. `phaseAt` already honours it.
 * Otherwise the answer follows the dates in `fright-fest.ts`, the same file the
 * site's haunted skin reads, so a game cannot disagree with the site about when
 * the event is.
 *
 * What this does NOT control: the site's own haunted look. That is painted by a
 * static boot script from the config alone, so only `enabled: false` plus a
 * deploy turns it off. The dashboard page says so.
 */

import { FRIGHT_FEST_THEME } from "./fright-fest";
import { phaseAt, type ThemePhase } from "./phase";
import type { ThemeWindow } from "./types";

/** `app_settings` key holding the dashboard mode. Unset means `auto`. */
export const GAME_EVENT_MODE_KEY = "event:fright-fest";

/**
 * `auto`: follow the event's dates. `off`: Halloween does not exist in any game,
 * whatever the date says. There is deliberately no forced-on mode: an event
 * outside its window has no dates, no board and no countdown to show.
 */
export const GAME_EVENT_MODES = ["auto", "off"] as const;
export type GameEventMode = (typeof GAME_EVENT_MODES)[number];

/** An unset, unreadable or unrecognised value is `auto`. */
export function parseGameEventMode(raw: string | null | undefined): GameEventMode {
  return raw === "off" ? "off" : "auto";
}

/** The body of `GET /api/v1/event`. Mirrored by `EventState` in the SDK contract. */
export interface GameEventState {
  /** The ONLY thing a game needs: show the event, or do not. */
  active: boolean;
  /** The event's stable name (`"fright-fest"`) while active, else `null`. */
  event: string | null;
  /** `"live"` while active; `"ended"` after the window closed; else `"off"`. */
  phase: ThemePhase;
  /** ISO instants (UTC) while active, else `null`. */
  startAt: string | null;
  /** When the event itself opens: before this, runs are practice. */
  opensAt: string | null;
  endAt: string | null;
  /** The server's clock, so a game can correct for a wrong device clock. */
  serverTime: string;
}

/** Pure: the answer for `theme` under dashboard `mode` at `nowMs`. */
export function resolveGameEvent(
  theme: ThemeWindow,
  mode: GameEventMode,
  nowMs: number,
): GameEventState {
  const serverTime = new Date(nowMs).toISOString();
  const none = (phase: ThemePhase): GameEventState => ({
    active: false,
    event: null,
    phase,
    startAt: null,
    opensAt: null,
    endAt: null,
    serverTime,
  });
  if (mode === "off") return none("off");
  const phase = phaseAt(theme, nowMs);
  if (phase !== "live") return none(phase);
  return {
    active: true,
    event: theme.event,
    phase,
    startAt: theme.startAt,
    opensAt: theme.opensAt ?? theme.startAt,
    endAt: theme.endAt,
    serverTime,
  };
}

/** The event games are told about today. A later event adds a sibling, not a flag. */
export const GAME_EVENT_THEME = FRIGHT_FEST_THEME;

/** The answer for the current moment. The one place a clock is read, for the route and the dashboard alike. */
export function gameEventNow(mode: GameEventMode): GameEventState {
  return resolveGameEvent(GAME_EVENT_THEME, mode, Date.now());
}
