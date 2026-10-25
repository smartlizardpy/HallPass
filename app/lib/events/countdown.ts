import type { ThemeWindow } from "./types";

export type Countdown = { to: "start" | "end"; d: number; h: number; m: number; s: number };

/**
 * When the event itself opens (`opensAt`, else `startAt`), or NaN when the
 * theme is disabled or its dates don't nest as `startAt <= opensAt < endAt`.
 */
export function opensAtMs(theme: ThemeWindow): number {
  if (!theme.enabled) return NaN;
  const start = Date.parse(theme.startAt);
  const opens = Date.parse(theme.opensAt ?? theme.startAt);
  const end = Date.parse(theme.endAt);
  if (![start, opens, end].every(Number.isFinite) || opens < start || opens >= end) return NaN;
  return opens;
}

/**
 * Time left until the event opens (before `opensAt`, including the skin's
 * preview days) or closes (after it); null when the theme is disabled, ended or
 * misconfigured. Pure and clock-injected, and reads only the theme window, never
 * the championship.
 */
export function countdownAt(theme: ThemeWindow, nowMs: number): Countdown | null {
  const opens = opensAtMs(theme);
  const end = Date.parse(theme.endAt);
  if (!Number.isFinite(opens) || nowMs >= end) return null;
  const to = nowMs < opens ? "start" : "end";
  const left = Math.max(0, Math.ceil(((to === "start" ? opens : end) - nowMs) / 1000));
  return {
    to,
    d: Math.floor(left / 86400),
    h: Math.floor((left % 86400) / 3600),
    m: Math.floor((left % 3600) / 60),
    s: left % 60,
  };
}
