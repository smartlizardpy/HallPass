/**
 * HallPass — how championship numbers and dates are written. Pure, client-safe,
 * clock-free (every date is formatted from an instant it is given), so server
 * and client render the same string.
 */

import type { MetricSpec } from "./types";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 312 → "5:12" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

/** 83_456 → "1:23.456" */
export function msClock(ms: number): string {
  const v = Math.max(0, Math.floor(ms));
  const s = Math.floor(v / 1000);
  return `${Math.floor(s / 60)}:${pad2(s % 60)}.${String(v % 1000).padStart(3, "0")}`;
}

export function formatScore(metric: MetricSpec, score: number): string {
  if (metric.format === "clock") return clock(score);
  if (metric.format === "ms-clock") return msClock(score);
  return Math.round(score).toLocaleString("en-GB");
}

export function formatTiebreak(metric: MetricSpec, value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (metric.tiebreakFormat === "clock") return clock(value);
  if (metric.tiebreakFormat === "seconds-2dp") {
    const whole = Math.floor(value);
    return `${clock(whole)}.${pad2(Math.round((value - whole) * 100) % 100)}`;
  }
  return Math.round(value).toLocaleString("en-GB");
}

const fmt = (timeZone: string, opts: Intl.DateTimeFormatOptions, ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, ...opts }).format(ms);

/** "Wed 28 Oct, 00:00" in the event's zone. */
export function formatInstant(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return `${fmt(timeZone, { weekday: "short", day: "numeric", month: "short" }, ms)}, ${fmt(
    timeZone,
    { hour: "2-digit", minute: "2-digit", hour12: false },
    ms,
  )}`;
}

/** "Wed 28 Oct" in the event's zone. */
export function formatDay(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? fmt(timeZone, { weekday: "short", day: "numeric", month: "short" }, ms) : "";
}

/**
 * The last moment of an exclusive close, for copy: closesAt 2 Nov 00:00 reads
 * "Sun 1 Nov, 23:59". Saying "ends 2 Nov, 00:00" is accurate and confusing.
 */
export function formatLastMinute(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatInstant(new Date(ms - 60_000).toISOString(), timeZone) : "";
}

/** "1st", "2nd", "3rd", "11th", "22nd" */
export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
