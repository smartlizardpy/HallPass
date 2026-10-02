/**
 * HallPass — the streak beacon's request body (pure: no `window`, no fetch).
 *
 * Split from `StreakBeacon.tsx` for the reason `core.ts` gives: `vitest` only
 * collects `*.test.ts` and there is no component harness, so the one thing in the
 * beacon worth being wrong — which day and which offset it reports — lives here.
 */

import { dayKey } from "./core";

export type StreakBeaconBody = {
  /** The device's own calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Minutes EAST of UTC — the NEGATION of `Date#getTimezoneOffset`. */
  tzOffsetMin: number;
};

/**
 * What to tell the server at `now`.
 *
 * `getTimezoneOffset` is minutes WEST of UTC (UTC+1 reports -60), so it is
 * negated; the server's `localParts` adds the offset. `|| 0` turns the `-0` that
 * a UTC device would otherwise produce into a plain zero.
 */
export function streakBeaconBody(now: Date): StreakBeaconBody {
  return { day: dayKey(now), tzOffsetMin: -now.getTimezoneOffset() || 0 };
}
