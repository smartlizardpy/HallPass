/**
 * HallPass — the server-side streak rules (pure: no database, no clock).
 *
 * The device-local model in `core.ts` keeps a list of played days. The server
 * keeps something much smaller — current run, longest run, and the last day it
 * advanced on — because all it has to answer is "is this player's streak alive,
 * and have they played yet today?". These functions are that rule, written once
 * so the store's SQL and the tests are both measured against it.
 *
 * ── A DAY IS THE PLAYER'S OWN DAY ──────────────────────────────────────────
 * The device reports its local `YYYY-MM-DD` and its UTC offset. The server never
 * derives a player's day from its own clock; it only uses its clock to check the
 * claim is plausible ({@link clampDay}) and to find the player's local hour for
 * the reminder ({@link localParts}).
 *
 * ── THE CLAIM IS CLAMPED, NOT TRUSTED ──────────────────────────────────────
 * Offsets run from UTC-12 to UTC+14, so a player's calendar day is never more
 * than one day away from the server's UTC date. Anything further is a clock
 * gone wrong or somebody editing a request. What a liar can fake is their own
 * flame and their own nudge time; nothing else (scores, rank, XP) reads this.
 */

import { diffDays, isDayKey, isMilestone } from "./core";

/** The local hour the at-risk reminder goes out in (17:00–17:59). */
export const REMINDER_HOUR = 17;

/** A run shorter than this is not yet worth a reminder: one day is not a habit. */
export const REMINDER_MIN_STREAK = 2;

/** The most reminders one run will send, so a runaway cannot fan out unbounded. */
export const REMINDER_RUN_CAP = 500;

/** Offsets are minutes EAST of UTC, within the real world's range. */
export const MAX_TZ_OFFSET_MIN = 840;

/** What the server remembers about one player's run. */
export type ServerStreak = {
  current: number;
  longest: number;
  /** The last local day the streak advanced on, `YYYY-MM-DD`. */
  lastDay: string;
};

const pad = (n: number): string => `${n}`.padStart(2, "0");

/** The UTC `YYYY-MM-DD` for an instant. */
export function utcDayKey(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Narrow an untrusted offset to whole minutes within range, or `null`. */
export function parseTzOffset(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  return Math.abs(n) <= MAX_TZ_OFFSET_MIN ? n : null;
}

/**
 * The player's local calendar day and hour at `nowMs`, given their offset
 * (minutes east of UTC).
 */
export function localParts(
  nowMs: number,
  tzOffsetMin: number,
): { day: string; hour: number } {
  const shifted = new Date(nowMs + tzOffsetMin * 60_000);
  return { day: utcDayKey(shifted.getTime()), hour: shifted.getUTCHours() };
}

/**
 * Accept a device's claimed day only if it is a well-formed key within one day
 * of the server's UTC date. Returns the day, or `null` if it is implausible.
 */
export function clampDay(day: unknown, nowMs: number): string | null {
  if (!isDayKey(day)) return null;
  // `Date.UTC` rolls "2026-02-31" into March, so round-trip it to reject that.
  const [y, m, d] = day.split("-").map(Number);
  const back = new Date(Date.UTC(y, m - 1, d));
  if (utcDayKey(back.getTime()) !== day) return null;
  return Math.abs(diffDays(utcDayKey(nowMs), day)) <= 1 ? day : null;
}

export type Advance = {
  state: ServerStreak;
  /** Whether this call moved the streak. A repeat or an older day does not. */
  advanced: boolean;
  /** Whether the new length is a milestone (only ever true when `advanced`). */
  milestone: boolean;
};

/**
 * Apply one reported day to what the server holds. The SQL in `server-store.ts`
 * implements exactly this, in one statement.
 *
 *   - no history      → a run of 1
 *   - the same day    → no change
 *   - an earlier day  → ignored (a stale beacon, or a clock set backwards)
 *   - the next day    → the run grows by one
 *   - a later gap     → the run restarts at 1
 */
export function applyDay(prev: ServerStreak | null, day: string): Advance {
  if (!prev) {
    return {
      state: { current: 1, longest: 1, lastDay: day },
      advanced: true,
      milestone: isMilestone(1),
    };
  }
  const gap = diffDays(prev.lastDay, day);
  if (gap <= 0) return { state: prev, advanced: false, milestone: false };

  const current = gap === 1 ? prev.current + 1 : 1;
  return {
    state: {
      current,
      longest: Math.max(prev.longest, current),
      lastDay: day,
    },
    advanced: true,
    milestone: isMilestone(current),
  };
}

/** What {@link isNudgeDue} needs to know about a player. */
export type NudgeCandidate = {
  current: number;
  lastDay: string;
  lastNudgedDay: string | null;
  tzOffsetMin: number;
};

/**
 * Is this player due a streak-at-risk reminder right now?
 *
 * Yes when their run is worth saving, it is still ALIVE but unextended (the last
 * day it advanced was their local yesterday, so it is today's play that keeps
 * it), it is the reminder hour where they are, and they have not been nudged
 * today. Somebody who already played today has `lastDay` = today and is skipped.
 * Somebody whose streak lapsed is skipped too — there is deliberately no
 * win-back message.
 */
export function isNudgeDue(c: NudgeCandidate, nowMs: number): boolean {
  if (c.current < REMINDER_MIN_STREAK) return false;
  const { day, hour } = localParts(nowMs, c.tzOffsetMin);
  if (hour !== REMINDER_HOUR) return false;
  if (diffDays(c.lastDay, day) !== 1) return false;
  return c.lastNudgedDay !== day;
}

/**
 * The first day of the run that ends on `day` and is `current` days long.
 *
 * Used to give a milestone an identity: "the 7-day streak that began on the 3rd"
 * is one event, whereas a bare "7" would also swallow the NEXT time the same
 * player builds a seven-day run after losing this one.
 */
export function runStartDay(day: string, current: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return utcDayKey(Date.UTC(y, m - 1, d - Math.max(0, current - 1)));
}
