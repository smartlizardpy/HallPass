"use client";

/**
 * HallPass — appearance preference store (browser-only).
 *
 * Holds the player's light/dark CHOICE in one localStorage key and exposes it to
 * React through `useSyncExternalStore`, so the sidebar hatch, the Settings card
 * and `ThemeController` all react the instant it changes — in this tab or in
 * another one (`storage` event).
 *
 * A deliberate copy of `lib/stealth/store.ts` (which is itself a copy of
 * `lib/personalization.ts`): cached module-scope snapshot so React's
 * "getSnapshot should be cached" guard is satisfied, a STABLE server snapshot so
 * the prerender and the hydration agree, and fail-soft `localStorage` access
 * guarded for SSR. Read those headers for the full rationale.
 *
 * TWO INPUTS, ONE OUTPUT. The snapshot carries the stored CHOICE and the
 * device's CURRENT preference, because `resolveTheme` needs both and the second
 * one changes under us (a Chromebook flipping to dark at sunset). The device
 * half is seeded on first read and kept current by `ThemeController`, which owns
 * the `matchMedia` subscription because it is a live behaviour with a listener
 * to clean up.
 *
 * WHAT THIS FILE DOES NOT DO: touch the DOM. Every write of `data-theme` goes
 * through `ThemeController`'s one effect, so there is exactly one writer after
 * the boot script and no path where a setter and an effect can disagree about
 * what the page is currently painted in.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  DARK_QUERY,
  DEFAULT_THEME,
  parseThemeChoice,
  resolveTheme,
  THEME_KEY,
  type ResolvedTheme,
  type ThemeChoice,
} from "./config";

// Re-exported so importers of the store need only one module for the common case.
export { THEME_KEY };

export type ThemeState = {
  /** What the player picked: `system`, `light` or `dark`. */
  choice: ThemeChoice;
  /** What the DEVICE currently asks for, regardless of the choice above. */
  system: ResolvedTheme;
};

/* -------------------------------------------------------------------------- *
 * Browser-guarded access (fail-soft).
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
    /* private mode / quota — the choice still applies for this page load. */
  }
}

/** The device preference right now, or `"light"` where it cannot be asked. */
export function readSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  try {
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/* -------------------------------------------------------------------------- *
 * Module-scope store: cached snapshot + pub/sub.
 * -------------------------------------------------------------------------- */

/**
 * Stable snapshot for SSR + hydration — MUST keep a constant reference.
 *
 * `system: "light"` here is not a guess at the device, it is the only honest
 * answer on a server that has none. It never reaches the page: the markup
 * carries no theme-dependent class (the theme is CSS variables and the
 * pre-paint attribute), so the first client snapshot replacing this one changes
 * no DOM the server rendered.
 */
const SERVER_SNAPSHOT: ThemeState = { choice: DEFAULT_THEME, system: "light" };

let snapshot: ThemeState = SERVER_SNAPSHOT;
let loaded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function ensureLoaded(): void {
  if (loaded || typeof window === "undefined") return;
  snapshot = {
    choice: parseThemeChoice(safeGet(THEME_KEY)),
    system: readSystemTheme(),
  };
  loaded = true;
}

function commit(next: ThemeState): void {
  snapshot = next;
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event: StorageEvent) => {
    // `key === null` is a whole-storage clear, which takes this key with it.
    if (event.key === THEME_KEY || event.key === null) {
      commit({ ...snapshot, choice: parseThemeChoice(safeGet(THEME_KEY)) });
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

function getSnapshot(): ThemeState {
  ensureLoaded();
  return snapshot;
}

function getServerSnapshot(): ThemeState {
  return SERVER_SNAPSHOT;
}

/* -------------------------------------------------------------------------- *
 * Imperative mutations (callable outside React).
 * -------------------------------------------------------------------------- */

/** Record a new choice. Persisted, then broadcast to every subscriber. */
export function setTheme(choice: ThemeChoice): void {
  ensureLoaded();
  const next = parseThemeChoice(choice);
  safeSet(THEME_KEY, next);
  commit({ ...snapshot, choice: next });
}

/**
 * Republish the device preference. Called only by `ThemeController`'s
 * `matchMedia` listener; it is NOT persisted, because it is a fact about the
 * device rather than a decision by the player.
 */
export function setSystemTheme(system: ResolvedTheme): void {
  ensureLoaded();
  if (snapshot.system === system) return;
  commit({ ...snapshot, system });
}

/* -------------------------------------------------------------------------- *
 * React hook.
 * -------------------------------------------------------------------------- */

/** Live appearance preference, the theme it resolves to, and the setter. */
export function useTheme(): {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setTheme: (choice: ThemeChoice) => void;
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    choice: state.choice,
    resolved: resolveTheme(state.choice, state.system === "dark"),
    setTheme: useCallback((choice: ThemeChoice) => setTheme(choice), []),
  };
}
