import type { ThemeWindow } from "./types";

export type ThemePhase = "off" | "live" | "ended";

/**
 * Where `nowMs` falls relative to the window. Pure, and the single definition of
 * "is the skin on": the boot script embeds the same bounds, and a test runs that
 * script against this function. A manual disable or an unparseable date is
 * always `off`, never `live`.
 */
export function phaseAt(theme: ThemeWindow, nowMs: number): ThemePhase {
  if (!theme.enabled) return "off";
  const start = Date.parse(theme.startAt);
  const end = Date.parse(theme.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "off";
  if (nowMs < start) return "off";
  if (nowMs >= end) return "ended";
  return "live";
}
