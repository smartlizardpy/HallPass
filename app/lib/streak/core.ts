/**
 * HallPass — daily-streak core (pure, no `window`, no clock).
 *
 * A streak is a run of consecutive CALENDAR days on which the player opened a
 * game. Everything here is a pure function of an explicit `today` day-key, so the
 * whole streak model is deterministic and unit-testable without mocking the clock
 * or a timezone — the store layer is the only place the real date enters.
 *
 * Day identity is LOCAL: a "day" is the player's own midnight-to-midnight, which
 * is what a streak intuitively means. Keys are `YYYY-MM-DD` strings, and all
 * arithmetic goes through `Date.UTC` on the parsed parts so a DST transition can
 * never make two adjacent calendar days look 23 or 25 hours — and therefore a
 * non-integer number of days — apart.
 */

/** How many day-keys we retain. Comfortably covers the calendar view and any
 *  realistic streak; a run longer than this simply stops growing the stored
 *  history, never the count that matters day to day. */
export const DAYS_CAP = 400;

/** Streak lengths worth celebrating with a milestone toast. */
export const MILESTONES = [3, 7, 14, 30, 50, 100, 150, 200, 365] as const;

export type StreakState = {
  /** Played day-keys, most-recent-first, de-duplicated, capped at {@link DAYS_CAP}. */
  days: string[];
  /** Longest streak ever reached — retained even if the recent history is capped. */
  longest: number;
};

export const EMPTY_STATE: StreakState = { days: [], longest: 0 };

/** Local `YYYY-MM-DD` for a Date. Uses local getters so the day boundary is the
 *  player's midnight, not UTC's. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True for a well-formed `YYYY-MM-DD` key. */
export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Whole calendar days from `a` to `b` (`b - a`); negative if `b` precedes `a`. */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}

/**
 * The current streak: the length of the consecutive run ending at the most recent
 * played day — but only while that run is still ALIVE, i.e. the last played day is
 * today or yesterday. If the last play is older than yesterday the streak has
 * lapsed and the current count is 0 (the run is history, not current).
 */
export function computeCurrentStreak(days: string[], today: string): number {
  if (days.length === 0) return 0;
  // `days` is maintained most-recent-first; guard anyway by taking the max.
  const sorted = [...new Set(days)].sort((x, y) => (x < y ? 1 : x > y ? -1 : 0));
  const gapToLast = diffDays(sorted[0], today);
  if (gapToLast < 0 || gapToLast > 1) return 0; // future date or lapsed → not current

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (diffDays(sorted[i], sorted[i - 1]) === 1) streak++;
    else break;
  }
  return streak;
}

/**
 * Record that the player opened a game on `today`. Idempotent for a day already
 * present. Returns the new state (never mutates) with `days` re-normalised and
 * `longest` bumped if today's play extends the record.
 */
export function recordDay(state: StreakState, today: string): StreakState {
  const days = [today, ...state.days.filter((d) => d !== today)]
    .sort((x, y) => (x < y ? 1 : x > y ? -1 : 0))
    .slice(0, DAYS_CAP);
  const current = computeCurrentStreak(days, today);
  return { days, longest: Math.max(state.longest, current) };
}

/** Whether `n` is a milestone streak length. */
export function isMilestone(n: number): boolean {
  return (MILESTONES as readonly number[]).includes(n);
}

export type CalendarDay = { key: string; played: boolean; isToday: boolean };

/**
 * The last `n` calendar days ending at `today`, oldest-first — for the streak
 * popover's little week strip. Each entry says whether it was played.
 */
export function lastNDays(days: string[], today: string, n: number): CalendarDay[] {
  const played = new Set(days);
  const [ty, tm, td] = today.split("-").map(Number);
  const out: CalendarDay[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(ty, tm - 1, td - i));
    const y = dt.getUTCFullYear();
    const m = `${dt.getUTCMonth() + 1}`.padStart(2, "0");
    const d = `${dt.getUTCDate()}`.padStart(2, "0");
    const key = `${y}-${m}-${d}`;
    out.push({ key, played: played.has(key), isToday: i === 0 });
  }
  return out;
}
