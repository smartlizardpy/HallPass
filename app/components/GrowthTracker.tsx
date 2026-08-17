"use client";

/**
 * HallPass — the retention marker.
 *
 * Renders nothing. It exists to turn an event the app ALREADY fires into the one
 * number `marketing-design.md` calls the north star: how many devices come back.
 *
 * WHY THERE IS NO TRACKER HERE. The obvious build is a returning-visitor tracker
 * with its own storage key and its own day maths, and it would be a second,
 * subtly-different copy of `app/lib/streak/`. That module already stamps a local
 * `YYYY-MM-DD` on every play, already collapses repeat plays within a calendar
 * day to a no-op, already handles DST correctly, and is already unit-tested. It
 * fires `STREAK_EVENT` at exactly the moment this wants to know about — the first
 * play of a new day. So this listens, and owns no state at all.
 *
 * WHY NOT FOLD IT INTO `StreakToast`, which listens to the same event: that
 * component is presentation, down to where it sits relative to the player's close
 * button. Analytics riding inside it would be invisible to anyone reading either
 * concern. Two listeners on one window event cost nothing.
 *
 * WHY ONE EVENT AND NOT TWO. `days` distinguishes a first-ever play from a
 * return, so the split belongs in a property rather than in two event names a
 * query would have to union back together. Which of these is "retention" is a
 * question for the dashboard, not for the capture site.
 *
 * DEVICES, NOT PEOPLE. The streak lives in `localStorage`, so on a shared school
 * Chromebook this counts the machine coming back, not the child. Every panel
 * built on it says "devices" for that reason — see `marketing-design.md` §2.
 */

import { useEffect } from "react";
import posthog from "posthog-js";
import { STREAK_EVENT, type StreakEventDetail } from "../lib/streak/store";

export function GrowthTracker() {
  useEffect(() => {
    const onStreak = (e: Event) => {
      const detail = (e as CustomEvent<StreakEventDetail>).detail;
      if (!detail || typeof detail.days !== "number" || detail.days < 1) return;

      try {
        posthog.capture("day_played", {
          // Distinct days this device has ever played. `1` is a device's first
          // ever day; anything higher is a return.
          days_played: detail.days,
          returning: detail.days > 1,
          streak: detail.current,
          longest_streak: detail.longest,
          milestone: detail.milestone,
        });
      } catch {
        /* Analytics must never break a play. */
      }
    };

    window.addEventListener(STREAK_EVENT, onStreak as EventListener);
    return () => window.removeEventListener(STREAK_EVENT, onStreak as EventListener);
  }, []);

  return null;
}
