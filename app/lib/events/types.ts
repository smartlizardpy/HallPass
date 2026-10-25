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

/**
 * `live`: the event window is open on this path (so the player may be offered the
 * appearance menu, even if they chose Normal). `on`: the skin is painted, and in
 * which of its two palettes. `on` implies `live`.
 */
export type EventResolution =
  | { live: false; on: false }
  | { live: true; on: false }
  | { live: true; on: true; theme: "dark" | "light" };

export interface ThemeWindow {
  /** Stable id of the feature, used for flags and documentation. */
  id: string;
  /**
   * Manual master switch. `false` beats the schedule: the skin never paints,
   * whatever the clock says.
   */
  enabled: boolean;
  /**
   * When the skin starts painting. ISO-8601 instant with an explicit `Z`;
   * inclusive. Always UTC. May be earlier than {@link opensAt}: a haunted
   * preview before the event itself opens.
   */
  startAt: string;
  /**
   * When the event itself opens: the countdown target and the first date in the
   * copy. ISO-8601 with `Z`, within `[startAt, endAt)`. Defaults to `startAt`.
   */
  opensAt?: string;
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
