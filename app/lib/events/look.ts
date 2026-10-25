import type { EventLook, EventResolution, ThemeWindow } from "./types";
import { phaseAt } from "./phase";

/** Whether `path` is `prefix` or beneath it (segment-aware: `/c` is not `/cookies`). */
export function isExcludedPath(path: string, excluded: readonly string[]): boolean {
  return excluded.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
}

/** Tolerantly read a stored event look; anything else is "nothing chosen". */
export function parseEventLook(raw: string | null | undefined): EventLook | null {
  return raw === "dark" || raw === "light" || raw === "normal" ? raw : null;
}

/**
 * The event's decision, given the clock, the path and what is in storage.
 *
 * The permanent theme (`hp:theme`) is only READ, never written. With no event
 * look chosen: an explicit Light gets Haunted Light; Dark, System and
 * never-chosen all get Haunted Dark (System counts as dark by decision). An
 * explicit event look wins; "normal" turns the skin off for that player.
 */
export function resolveEvent(
  theme: ThemeWindow,
  input: {
    nowMs: number;
    path: string;
    eventLook: string | null | undefined;
    savedTheme: string | null | undefined;
  },
): EventResolution {
  if (phaseAt(theme, input.nowMs) !== "live") return { on: false };
  if (isExcludedPath(input.path, theme.excludedPaths)) return { on: false };
  const look = parseEventLook(input.eventLook);
  if (look === "normal") return { on: false };
  if (look) return { on: true, theme: look };
  return { on: true, theme: input.savedTheme === "light" ? "light" : "dark" };
}
