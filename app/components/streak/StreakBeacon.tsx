"use client";

/**
 * HallPass — tells the server the player's streak advanced.
 *
 * Listens for the same window event `StreakToast` and `GrowthTracker` do, which
 * the device-local streak store fires only on the FIRST play of a local day, so
 * this posts at most once per device per day. It renders nothing.
 *
 * It is its own island rather than a line in `GrowthTracker` because that
 * component's docblock explains it is deliberately an analytics-only listener;
 * a write the server acts on does not belong in it.
 *
 * Fire-and-forget with `keepalive`, the same as `recordPlayServerSide`: the event
 * fires as a game opens, which is immediately followed by the overlay mounting.
 * A guest gets `200 { recorded: false }` from the route, so there is nothing to
 * guard here and no console noise.
 */

import { useEffect } from "react";
import { streakBeaconBody } from "../../lib/streak/beacon";
import { STREAK_EVENT } from "../../lib/streak/store";

export function StreakBeacon() {
  useEffect(() => {
    const onStreak = () => {
      void fetch("/api/v1/me/streak", {
        method: "POST",
        keepalive: true,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(streakBeaconBody(new Date())),
      }).catch(() => {});
    };
    window.addEventListener(STREAK_EVENT, onStreak);
    return () => window.removeEventListener(STREAK_EVENT, onStreak);
  }, []);

  return null;
}
