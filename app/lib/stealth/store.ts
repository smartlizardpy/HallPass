"use client";

/**
 * HallPass — stealth-mode preference store (browser-only).
 *
 * Holds the player's three stealth choices in ONE localStorage key and exposes
 * them to React through `useSyncExternalStore`, so the tab cloak, the panic
 * controller and the settings modal all react the instant any of them changes —
 * in this tab or another (`storage` event).
 *
 * The design is a deliberate copy of `app/lib/personalization.ts`: a cached
 * module-scope snapshot (stable reference until a real change, so React's
 * "getSnapshot should be cached" guard is satisfied), a STABLE server snapshot so
 * the prerender and hydration agree, and fail-soft localStorage access guarded
 * for SSR. Read that file's header for the full rationale; the same rules apply.
 *
 * The parse/serialise helpers are pure and exported for unit testing (node env,
 * no jsdom) — everything below `getServerSnapshot` touches `window` and is
 * guarded.
 */

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_CLOAK_ID, cloakById } from "./cloaks";
import {
  DEFAULT_PANIC_KEY,
  DEFAULT_PANIC_SCREEN,
  STEALTH_KEY,
  type PanicScreenId,
  isPanicScreen,
} from "./config";

// Re-exported so existing importers of the key keep working; the literal is
// defined once in `config.ts` and shared with the server boot script.
export { STEALTH_KEY };

export type StealthPrefs = {
  /** Cloak preset id (see `cloaks.ts`). */
  cloak: string;
  /** The `KeyboardEvent.key` that triggers/dismisses the panic screen. */
  panicKey: string;
  /** Which fake screen the panic key raises. */
  panicScreen: PanicScreenId;
};

/** The out-of-the-box prefs: no disguise, backtick panic key, blank-doc screen. */
export const DEFAULT_PREFS: StealthPrefs = {
  cloak: DEFAULT_CLOAK_ID,
  panicKey: DEFAULT_PANIC_KEY,
  panicScreen: DEFAULT_PANIC_SCREEN,
};

/* -------------------------------------------------------------------------- *
 * Pure helpers — no `window`, fully unit-testable.
 * -------------------------------------------------------------------------- */

/**
 * Tolerantly parse stored prefs. Any missing, wrong-typed, or unknown field
 * falls back to its default, so a corrupt or partial payload (or one written by
 * an older build) can never yield an invalid state. Never throws.
 */
export function parsePrefs(raw: string | null): StealthPrefs {
  if (raw == null) return { ...DEFAULT_PREFS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DEFAULT_PREFS };
  }
  const obj = parsed as Record<string, unknown>;
  // Validate the cloak id against the real preset list — an id with no preset
  // resolves to `off` rather than leaving the tab pointing at nothing.
  const cloak =
    typeof obj.cloak === "string" ? cloakById(obj.cloak).id : DEFAULT_PREFS.cloak;
  const panicKey =
    typeof obj.panicKey === "string" && obj.panicKey.length > 0
      ? obj.panicKey
      : DEFAULT_PREFS.panicKey;
  const panicScreen =
    typeof obj.panicScreen === "string" && isPanicScreen(obj.panicScreen)
      ? obj.panicScreen
      : DEFAULT_PREFS.panicScreen;
  return { cloak, panicKey, panicScreen };
}

/** Serialise prefs to the canonical JSON string stored in localStorage. */
export function serializePrefs(prefs: StealthPrefs): string {
  return JSON.stringify(prefs);
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

/** Stable empty snapshot for SSR + hydration — MUST keep a constant reference. */
const SERVER_SNAPSHOT: StealthPrefs = DEFAULT_PREFS;

let snapshot: StealthPrefs = DEFAULT_PREFS;
let loaded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function ensureLoaded(): void {
  if (loaded || typeof window === "undefined") return;
  snapshot = parsePrefs(safeGet(STEALTH_KEY));
  loaded = true;
}

function commit(next: StealthPrefs): void {
  snapshot = next;
  safeSet(STEALTH_KEY, serializePrefs(next));
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key === STEALTH_KEY || event.key === null) {
      snapshot = parsePrefs(safeGet(STEALTH_KEY));
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

function getSnapshot(): StealthPrefs {
  ensureLoaded();
  return snapshot;
}

function getServerSnapshot(): StealthPrefs {
  return SERVER_SNAPSHOT;
}

/* -------------------------------------------------------------------------- *
 * Imperative mutations (callable outside React).
 * -------------------------------------------------------------------------- */

export function setCloak(id: string): void {
  ensureLoaded();
  commit({ ...snapshot, cloak: cloakById(id).id });
}

export function setPanicKey(key: string): void {
  if (!key) return;
  ensureLoaded();
  commit({ ...snapshot, panicKey: key });
}

export function setPanicScreen(id: PanicScreenId): void {
  ensureLoaded();
  commit({ ...snapshot, panicScreen: isPanicScreen(id) ? id : DEFAULT_PREFS.panicScreen });
}

/* -------------------------------------------------------------------------- *
 * Settings-modal open signal.
 *
 * The modal lives once inside `StealthController` (in the root layout); trigger
 * buttons can sit anywhere in the tree. Rather than thread state through every
 * layer, a launcher dispatches this window event and the controller listens for
 * it. A CustomEvent name is the smallest possible coupling between the two.
 * -------------------------------------------------------------------------- */

export const OPEN_STEALTH_EVENT = "hp:open-stealth";

/** Ask the mounted controller to open the stealth settings modal. */
export function openStealthSettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_STEALTH_EVENT));
}

/* -------------------------------------------------------------------------- *
 * React hook.
 * -------------------------------------------------------------------------- */

/** Live stealth prefs + setters. Re-renders the instant any pref changes. */
export function useStealth(): {
  prefs: StealthPrefs;
  setCloak: (id: string) => void;
  setPanicKey: (key: string) => void;
  setPanicScreen: (id: PanicScreenId) => void;
} {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    prefs,
    setCloak: useCallback((id: string) => setCloak(id), []),
    setPanicKey: useCallback((key: string) => setPanicKey(key), []),
    setPanicScreen: useCallback((id: PanicScreenId) => setPanicScreen(id), []),
  };
}
