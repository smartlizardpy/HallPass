"use client";

/**
 * HallPass — tells the server the player's streak advanced.
 *
 * Posts in two situations, both through the same {@link send}:
 *
 *   1. The device's streak advances into a new local day — the window event
 *      `StreakToast` and `GrowthTracker` also hear, fired only on the first play
 *      of a day.
 *   2. On load, whenever this device already counts today and the server has not
 *      yet confirmed it. That is the retry the event alone could not give: a guest
 *      who played and then signed in, or a request that was dropped.
 *
 * "Confirmed" is a localStorage marker written ONLY when the server answers
 * `recorded: true`. A guest gets `recorded: false`, so nothing is remembered
 * until they sign in, and the next load then sends. The server treats a repeat of
 * the same day as a no-op, so over-sending is harmless; the marker only keeps
 * it from happening on every page load. (The marker is per DEVICE, so on a shared
 * Chromebook the second player to sign in the same day is not re-sent — the
 * device-local streak has the same limit.)
 *
 * It is its own island rather than a line in `GrowthTracker` because that
 * component's docblock explains it is deliberately an analytics-only listener.
 *
 * Fire-and-forget with `keepalive`, like `recordPlayServerSide`: the event fires
 * as a game opens, which is immediately followed by the overlay mounting. It
 * renders nothing.
 */

import { useEffect } from "react";
import { dayKey } from "../../lib/streak/core";
import { SYNCED_KEY, needsSync, streakBeaconBody } from "../../lib/streak/beacon";
import { STREAK_EVENT, STREAK_KEY, parseState } from "../../lib/streak/store";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — best-effort; the next load simply sends again. */
  }
}

/** Post today's streak, and remember it only if the server says it has it. */
function send(): void {
  const days = parseState(read(STREAK_KEY)).days;
  const body = streakBeaconBody(new Date(), days);
  void fetch("/api/v1/me/streak", {
    method: "POST",
    keepalive: true,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((json: { recorded?: unknown } | null) => {
      if (json?.recorded === true) write(SYNCED_KEY, body.day);
    })
    .catch(() => {});
}

export function StreakBeacon() {
  useEffect(() => {
    // The retry: this device already counts today, the server has not confirmed it.
    const days = parseState(read(STREAK_KEY)).days;
    if (needsSync(days, dayKey(new Date()), read(SYNCED_KEY))) send();

    window.addEventListener(STREAK_EVENT, send);
    return () => window.removeEventListener(STREAK_EVENT, send);
  }, []);

  return null;
}
