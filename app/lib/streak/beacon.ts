/**
 * HallPass — the streak beacon's request body and send rule (pure: no `window`,
 * no fetch).
 *
 * Split from `StreakBeacon.tsx` for the reason `core.ts` gives: `vitest` only
 * collects `*.test.ts` and there is no component harness, so what the beacon
 * reports and WHEN it decides to send both live here.
 *
 * ── WHY IT IS NOT JUST "ON THE FIRST PLAY OF THE DAY" ──────────────────────
 * The device event fires once per local day and never retries, which broke the
 * server's picture of the streak in two ways: a guest who plays and THEN signs in
 * the same day was never told to the server (so the 17:00 reminder warned them
 * about a streak they had already kept), and a single dropped request made the
 * next day look like a gap and reset the run. So the beacon also fires on load
 * whenever the device already counts today and the server has not yet confirmed
 * it. The server's same-day no-op makes a repeat harmless.
 */

import { computeCurrentStreak, dayKey } from "./core";

/**
 * `localStorage` key holding the last local day the SERVER confirmed for this
 * device. Set only when the server answers `recorded: true` — a guest's
 * `recorded: false` must not suppress the send after they sign in.
 */
export const SYNCED_KEY = "hp:streak-synced";

export type StreakBeaconBody = {
  /** The device's own calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Minutes EAST of UTC — the NEGATION of `Date#getTimezoneOffset`. */
  tzOffsetMin: number;
  /**
   * The device's own current streak. The server uses it to SEED a brand-new row
   * only (clamped, never raising an existing one), so a 40-day local flame does
   * not become "Your 2-day streak".
   */
  current: number;
};

/**
 * What to tell the server at `now`, given the device's played days.
 *
 * `getTimezoneOffset` is minutes WEST of UTC (UTC+1 reports -60), so it is
 * negated; the server's `localParts` adds the offset. `|| 0` turns the `-0` that
 * a UTC device would otherwise produce into a plain zero.
 */
export function streakBeaconBody(now: Date, days: string[]): StreakBeaconBody {
  const day = dayKey(now);
  return {
    day,
    tzOffsetMin: -now.getTimezoneOffset() || 0,
    current: Math.max(1, computeCurrentStreak(days, day)),
  };
}

/**
 * Whether a load-time send is due: the device already counts today as played,
 * and the server has not yet confirmed that day for this device.
 *
 * A device that has not played today has nothing to report, so a plain visit
 * sends nothing.
 */
export function needsSync(days: string[], today: string, marker: string | null): boolean {
  return days.includes(today) && marker !== today;
}
