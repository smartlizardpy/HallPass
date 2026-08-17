"use client";

/**
 * HallPass — daily-streak store (browser-only).
 *
 * The device-local companion to the pure model in `core.ts`. Persists the played
 * day history in localStorage and exposes it to React via `useSyncExternalStore`,
 * with the same cached-snapshot / stable-server-snapshot / fail-soft rules as
 * `personalization.ts` and the stealth store (see those headers for the full
 * rationale).
 *
 * This is where the real clock enters — {@link recordPlay} stamps "today" with
 * `new Date()`. It is called from the exact spot recently-played is recorded
 * (`PlayerOverlay`), so a streak advances precisely when a game actually opens.
 * A day already counted is a no-op, so replaying a game later the same day costs
 * nothing and fires no toast.
 */

import { useSyncExternalStore } from "react";
import {
  EMPTY_STATE,
  type StreakState,
  computeCurrentStreak,
  dayKey,
  isDayKey,
  isMilestone,
  recordDay,
} from "./core";

/** localStorage key holding the JSON-encoded {@link StreakState}. */
export const STREAK_KEY = "hp:streak";

/** Window event fired when a play advances the streak into a NEW day. */
export const STREAK_EVENT = "hp:streak";

export type StreakEventDetail = {
  current: number;
  longest: number;
  milestone: boolean;
  /**
   * TOTAL distinct days this device has ever played, after counting today.
   *
   * Carried because `current` alone cannot tell a first-ever play from a return
   * after a gap — both read `current: 1` — and those are the two facts a
   * retention measure most needs to separate. `days === 1` is a brand-new
   * device; `days >= 2` is somebody coming back. Nothing in the UI reads it;
   * `GrowthTracker` does. Capped like `state.days` itself (`DAYS_CAP`), so on a
   * very long-lived device it saturates rather than growing forever.
   */
  days: number;
};

/* -------------------------------------------------------------------------- *
 * Pure parse/serialise — exported for unit testing.
 * -------------------------------------------------------------------------- */

/** Tolerantly parse stored state; any corrupt field falls back to empty. Never throws. */
export function parseState(raw: string | null): StreakState {
  if (raw == null) return { ...EMPTY_STATE };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_STATE };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...EMPTY_STATE };
  }
  const obj = parsed as Record<string, unknown>;
  const days = Array.isArray(obj.days) ? obj.days.filter(isDayKey) : [];
  const longest =
    typeof obj.longest === "number" && Number.isFinite(obj.longest) && obj.longest >= 0
      ? Math.floor(obj.longest)
      : 0;
  return { days, longest };
}

export function serializeState(state: StreakState): string {
  return JSON.stringify(state);
}

/* -------------------------------------------------------------------------- *
 * Browser-guarded localStorage (fail-soft).
 * -------------------------------------------------------------------------- */

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — best-effort. */
  }
}

/* -------------------------------------------------------------------------- *
 * Module-scope store: cached snapshot + pub/sub.
 * -------------------------------------------------------------------------- */

const SERVER_SNAPSHOT: StreakState = EMPTY_STATE;
let snapshot: StreakState = EMPTY_STATE;
let loaded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function ensureLoaded(): void {
  if (loaded || typeof window === "undefined") return;
  snapshot = parseState(safeGet(STREAK_KEY));
  loaded = true;
}

function commit(next: StreakState): void {
  snapshot = next;
  safeSet(STREAK_KEY, serializeState(next));
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key === STREAK_KEY || event.key === null) {
      snapshot = parseState(safeGet(STREAK_KEY));
      emit();
    }
  });
}

function subscribe(listener: () => void): () => void {
  ensureLoaded();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): StreakState {
  ensureLoaded();
  return snapshot;
}

function getServerSnapshot(): StreakState {
  return SERVER_SNAPSHOT;
}

/* -------------------------------------------------------------------------- *
 * Imperative mutation.
 * -------------------------------------------------------------------------- */

/**
 * Count a play toward today's streak. No-op (and silent) if today is already
 * counted; otherwise commits the new state and fires {@link STREAK_EVENT} so the
 * toast can celebrate the advance (and any milestone).
 */
export function recordPlay(): void {
  ensureLoaded();
  const today = dayKey(new Date());
  if (snapshot.days.includes(today)) return; // already counted today

  const next = recordDay(snapshot, today);
  commit(next);

  const current = computeCurrentStreak(next.days, today);
  if (typeof window !== "undefined") {
    const detail: StreakEventDetail = {
      current,
      longest: next.longest,
      milestone: isMilestone(current),
      days: next.days.length,
    };
    window.dispatchEvent(new CustomEvent(STREAK_EVENT, { detail }));
  }
}

/* -------------------------------------------------------------------------- *
 * React hook.
 * -------------------------------------------------------------------------- */

/** Live streak view: current run, all-time longest, and the raw played days. */
export function useStreak(): { current: number; longest: number; days: string[] } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const today = typeof window === "undefined" ? "" : dayKey(new Date());
  const current = today ? computeCurrentStreak(state.days, today) : 0;
  return { current, longest: state.longest, days: state.days };
}
