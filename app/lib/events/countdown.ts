import type { ThemeWindow } from "./types";
import { phaseAt } from "./phase";

export type Countdown = { to: "start" | "end"; d: number; h: number; m: number; s: number };

/**
 * Time left until the window opens (before it) or closes (during it); null when
 * the theme is disabled, ended or misconfigured. Pure and clock-injected, and
 * reads only the theme window, never the championship.
 */
export function countdownAt(theme: ThemeWindow, nowMs: number): Countdown | null {
  if (!theme.enabled) return null;
  const start = Date.parse(theme.startAt);
  const end = Date.parse(theme.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const phase = phaseAt(theme, nowMs);
  if (phase === "ended") return null;
  const target = phase === "live" ? end : start;
  const left = Math.max(0, Math.ceil((target - nowMs) / 1000));
  return {
    to: phase === "live" ? "end" : "start",
    d: Math.floor(left / 86400),
    h: Math.floor((left % 86400) / 3600),
    m: Math.floor((left % 3600) / 60),
    s: left % 60,
  };
}
