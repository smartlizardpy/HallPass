"use client";

/**
 * HallPass — the event appearance store (browser-only).
 *
 * Holds the player's choice in the EVENT's own localStorage key (never `hp:theme`)
 * plus the "still mode" switch, via `useSyncExternalStore`. A deliberate sibling
 * of `lib/theme/store.ts`: cached snapshot, stable server snapshot, fail-soft
 * storage. It touches no DOM; `EventController` is the only writer of the
 * event attributes.
 */

import { useCallback, useSyncExternalStore } from "react";
import { FRIGHT_FEST_THEME } from "./fright-fest";
import { parseEventLook } from "./look";
import type { EventLook } from "./types";

const STILL_KEY = FRIGHT_FEST_THEME.lookKey + ":still";

export type EventLookState = { look: EventLook | null; still: boolean };

const SERVER: EventLookState = { look: null, still: false };
let snapshot = SERVER;
let loaded = false;
const listeners = new Set<() => void>();

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode — the choice still applies for this page load. */
  }
}

function read(): EventLookState {
  return {
    look: parseEventLook(safeGet(FRIGHT_FEST_THEME.lookKey)),
    still: safeGet(STILL_KEY) === "1",
  };
}

function ensureLoaded(): void {
  if (loaded || typeof window === "undefined") return;
  snapshot = read();
  loaded = true;
}

function commit(next: EventLookState): void {
  snapshot = next;
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key === null || e.key === FRIGHT_FEST_THEME.lookKey || e.key === STILL_KEY) {
      commit(read());
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

export function setEventLook(look: EventLook | null): void {
  ensureLoaded();
  safeSet(FRIGHT_FEST_THEME.lookKey, look);
  commit({ ...snapshot, look });
}

export function setEventStill(still: boolean): void {
  ensureLoaded();
  safeSet(STILL_KEY, still ? "1" : null);
  commit({ ...snapshot, still });
}

export function useEventLook(): EventLookState & {
  setLook: (look: EventLook | null) => void;
  setStill: (still: boolean) => void;
} {
  const state = useSyncExternalStore(
    subscribe,
    () => {
      ensureLoaded();
      return snapshot;
    },
    () => SERVER,
  );
  return {
    ...state,
    setLook: useCallback((look: EventLook | null) => setEventLook(look), []),
    setStill: useCallback((still: boolean) => setEventStill(still), []),
  };
}
