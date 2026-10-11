"use client";

/**
 * HallPass — what this DEVICE has learned about a signed-in player's taste.
 *
 * The input to `for-you.ts`, and the part of that feature with a privacy story,
 * so the rules are stated here and enforced here:
 *
 *   * ON THIS DEVICE ONLY. A per-game play count and last-played time in
 *     `localStorage` (`hp:taste`). It is never sent to the server, never synced to
 *     an account, and no analytics event carries any of it. Signing in on another
 *     device starts that device from its own history.
 *   * ONLY WHILE SIGNED IN. Signing in is the opt-in; a guest has nothing recorded
 *     about them. {@link recordTastePlay} checks a hint the page refreshes from
 *     `/api/v1/me` on every load, and {@link syncSignedIn} DELETES the record the
 *     moment it learns the visitor is signed out — this audience shares school
 *     computers, and the next person to sit down must not inherit a profile.
 *   * OFF MEANS GONE. Turning the preference off clears the record and stops
 *     recording; it does not just stop showing it.
 *   * CAPPED AND FAIL-SOFT. At most {@link TASTE_CAP} games, oldest dropped. Every
 *     `localStorage` access is guarded: a private-mode or full-quota browser
 *     degrades to "no personalisation", never an exception in a render.
 *
 * Shaped after `personalization.ts` and `catalog-prefs.ts`: `useSyncExternalStore`
 * with CACHED snapshots (the same reference until the data really changes, or
 * React's "getSnapshot should be cached" guard loops) and a STABLE empty server
 * snapshot, so the server render and hydration agree and the personalised order
 * simply appears after hydration.
 */

import { useEffect, useSyncExternalStore } from "react";
import type { MeResponse } from "@/sdk/src/contract";
import type { TasteEntry } from "./for-you";

const TASTE_KEY = "hp:taste";
const PREF_KEY = "hp:foryou";
const SIGNED_IN_KEY = "hp:signed-in";

/** How many games the record keeps; the least recently played drop off first. */
export const TASTE_CAP = 60;
const VERSION = 1;

export type Taste = Record<string, TasteEntry>;

/* -------------------------------------------------------------------------- *
 * Pure helpers — no `window`, unit-tested.
 * -------------------------------------------------------------------------- */

/** Tolerantly parse a stored record. Anything malformed is "no history". */
export function parseTaste(raw: string | null): Taste {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as { v?: unknown; games?: unknown };
    if (data?.v !== VERSION || typeof data.games !== "object" || data.games === null) return {};
    const out: Taste = {};
    for (const [slug, entry] of Object.entries(data.games as Record<string, unknown>)) {
      const e = entry as { n?: unknown; t?: unknown } | null;
      if (
        typeof e?.n === "number" && Number.isFinite(e.n) && e.n > 0 &&
        typeof e?.t === "number" && Number.isFinite(e.t)
      ) {
        out[slug] = { n: Math.min(Math.floor(e.n), 10_000), t: e.t };
      }
    }
    return capTaste(out);
  } catch {
    return {};
  }
}

export function serializeTaste(taste: Taste): string {
  return JSON.stringify({ v: VERSION, games: taste });
}

/** Keep the {@link TASTE_CAP} most recently played games. */
export function capTaste(taste: Taste, cap: number = TASTE_CAP): Taste {
  const entries = Object.entries(taste);
  if (entries.length <= cap) return taste;
  entries.sort((a, b) => b[1].t - a[1].t);
  return Object.fromEntries(entries.slice(0, cap));
}

/** `taste` with one more play of `slug` at `now`. Never mutates its input. */
export function withPlay(taste: Taste, slug: string, now: number): Taste {
  const prev = taste[slug];
  return capTaste({ ...taste, [slug]: { n: (prev?.n ?? 0) + 1, t: now } });
}

/* -------------------------------------------------------------------------- *
 * The device store.
 * -------------------------------------------------------------------------- */

const EMPTY: Taste = Object.freeze({}) as Taste;
const listeners = new Set<() => void>();

function get(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota or private mode: personalisation quietly does nothing.
  }
}
function del(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}
const emit = () => listeners.forEach((l) => l());

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange); // keep tabs in sync
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Cached by the raw string, so the snapshot's identity changes only with the data. */
let tasteRaw: string | null | undefined;
let tasteSnapshot: Taste = EMPTY;
function getTasteSnapshot(): Taste {
  const raw = get(TASTE_KEY);
  if (raw !== tasteRaw) {
    tasteRaw = raw;
    const parsed = parseTaste(raw);
    tasteSnapshot = Object.keys(parsed).length === 0 ? EMPTY : parsed;
  }
  return tasteSnapshot;
}

/** Is personalisation switched on on this device? Default: yes. */
export function forYouEnabled(): boolean {
  return get(PREF_KEY) !== "off";
}

/** The hint that the visitor is signed in, refreshed from `/api/v1/me` on each load. */
export function signedInHint(): boolean {
  return get(SIGNED_IN_KEY) === "1";
}

/**
 * Record one play of `slug`. A no-op for a guest, and when the player has turned
 * personalisation off — in both cases nothing is written.
 */
export function recordTastePlay(slug: string, now: number = Date.now()): void {
  if (!slug || !signedInHint() || !forYouEnabled()) return;
  set(TASTE_KEY, serializeTaste(withPlay(parseTaste(get(TASTE_KEY)), slug, now)));
  emit();
}

/** Forget everything this device has learned. */
export function resetTaste(): void {
  del(TASTE_KEY);
  emit();
}

/** The settings switch. Turning it OFF also forgets what was learned. */
export function setForYouEnabled(on: boolean): void {
  if (on) del(PREF_KEY);
  else {
    set(PREF_KEY, "off");
    del(TASTE_KEY);
  }
  emit();
}

/**
 * Record whether the visitor is signed in. Signed OUT deletes the taste record, so
 * a shared computer never hands one player's profile to the next.
 */
export function syncSignedIn(signedIn: boolean): void {
  if (signedIn) set(SIGNED_IN_KEY, "1");
  else {
    del(SIGNED_IN_KEY);
    del(TASTE_KEY);
  }
  emit();
}

/* -------------------------------------------------------------------------- *
 * React.
 * -------------------------------------------------------------------------- */

export function useTaste(): Taste {
  return useSyncExternalStore(subscribe, getTasteSnapshot, () => EMPTY);
}

/** The settings switch's value. `true` on the server and the hydrating render. */
export function useForYouEnabled(): boolean {
  return useSyncExternalStore(subscribe, forYouEnabled, () => true);
}

/** Whether the visitor looks signed in. `false` on the server and the hydrating render. */
export function useSignedInHint(): boolean {
  return useSyncExternalStore(subscribe, signedInHint, () => false);
}

/**
 * Refresh the signed-in hint from `/api/v1/me`, once per page load however many
 * components ask. Fail-soft: a failed request leaves the hint as it was.
 */
let meRequest: Promise<void> | null = null;
export function useSignedInSync(): void {
  useEffect(() => {
    if (!meRequest) {
      meRequest = fetch("/api/v1/me", { credentials: "include" })
        .then((r) => (r.ok ? (r.json() as Promise<MeResponse>) : null))
        .then((me) => {
          if (me) syncSignedIn(Boolean(me.player));
        })
        .catch(() => {});
    }
  }, []);
}
