/**
 * HallPass — seasonal event types. Pure data, no `window`.
 *
 * An event's THEME (how the site looks) is described here and nowhere near its
 * COMPETITION (what you can win), which has its own module and its own flag.
 * That split is the point of this folder: the haunted skin must be able to ship,
 * expire and be switched off without the championship existing at all.
 */

/** What a player picked in the event's own appearance menu. */
export type EventLook = "dark" | "light" | "normal";

/** Whether the skin is painted right now, and in which of its two palettes. */
export type EventResolution =
  | { on: false }
  | { on: true; theme: "dark" | "light" };

export interface ThemeWindow {
  /** Stable id of the feature, used for flags and documentation. */
  id: string;
  /**
   * Manual master switch. `false` beats the schedule: the skin never paints,
   * whatever the clock says.
   */
  enabled: boolean;
  /** ISO-8601 instant with an explicit `Z`; inclusive. Always UTC. */
  startAt: string;
  /** ISO-8601 instant with an explicit `Z`; exclusive. Always UTC. */
  endAt: string;
  /** Value written to `data-hp-event` on `<html>`. */
  event: string;
  /** Value written to `data-hp-skin` on `<html>`; also names the palette. */
  skin: string;
  /** localStorage key holding the player's {@link EventLook} for this event. */
  lookKey: string;
  /**
   * Path prefixes where the skin never paints: utility, sign-in and
   * third-party surfaces. A prefix matches itself and anything beneath it.
   */
  excludedPaths: readonly string[];
}
