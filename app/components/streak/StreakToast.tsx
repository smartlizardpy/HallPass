"use client";

/**
 * HallPass — the streak toast.
 *
 * Listens for the streak store's advance event and briefly celebrates when a play
 * pushes the streak into a new day, with an extra flourish on a milestone. Mounted
 * once in the root layout. It fires the moment a game opens, so it deliberately
 * sits above the fullscreen player overlay (but below the panic screen).
 *
 * ── SITTING ON TOP OF THE PLAYER IS NOT A LICENCE TO BLOCK IT ───────────────
 * `recordPlay()` fires from `PlayerOverlay`'s open effect, so this toast appears
 * at the exact moment a game launches — centred, at the top, above the overlay.
 * On a ~390px phone the longest of these strings spans nearly the full width and
 * lands squarely on the ✕ pinned to the right of the player's top bar. Two
 * separate faults came out of that, and both are fixed here:
 *
 *   1. The pill carried `pointer-events-auto` (unlike `WelcomeToast` or the PWA
 *      pill), so for several seconds it ATE the first tap on Close. Nothing about
 *      this toast is interactive; the container is already `pointer-events-none`
 *      and the pill now inherits that, so taps land on the button underneath.
 *   2. It still covered the bar it was no longer blocking. When something owns
 *      the screen it now drops below that chrome instead of across it.
 *
 * The offset is decided ONCE, when the event fires, from {@link isOverlayOpen} —
 * not polled, and not read at render. That is sound because the player takes the
 * overlay lock in an effect declared BEFORE the one that records the play, so the
 * lock is already held by the time this event arrives.
 *
 * Purely reactive to the window event — it holds no state of its own beyond the
 * currently-showing message, so it never runs on the server and adds nothing to
 * the prerender.
 */

import { useEffect, useState } from "react";
import { isOverlayOpen } from "../../lib/overlay-lock";
import { STREAK_EVENT, type StreakEventDetail } from "../../lib/streak/store";

/**
 * How far to drop the toast when an overlay owns the screen.
 *
 * Enough to clear the player's top bar at both of its heights — 44px plus the
 * safe-area inset on a phone, `h-14` on a desktop — measured from the toast's own
 * `top-4`, which the inset is added to separately.
 */
const OVERLAY_CLEARANCE = "4rem";

type Toast = {
  text: string;
  milestone: boolean;
  /** Whether something else owned the screen when this toast was raised. */
  overlay: boolean;
};

export function StreakToast() {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const onStreak = (e: Event) => {
      const detail = (e as CustomEvent<StreakEventDetail>).detail;
      if (!detail || detail.current < 1) return;
      const { current, milestone } = detail;

      setToast({
        text: milestone
          ? `${current}-day streak! You're on fire.`
          : current === 1
          ? "Streak started — come back tomorrow!"
          : `${current}-day streak!`,
        milestone,
        overlay: isOverlayOpen(),
      });

      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setToast(null), milestone ? 5000 : 3500);
    };

    window.addEventListener(STREAK_EVENT, onStreak);
    return () => {
      window.removeEventListener(STREAK_EVENT, onStreak);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-4 z-[130] flex justify-center px-4"
      style={{
        paddingTop: toast.overlay
          ? `calc(env(safe-area-inset-top) + ${OVERLAY_CLEARANCE})`
          : "env(safe-area-inset-top)",
      }}
    >
      <div
        className={`streak-toast flex items-center gap-2.5 rounded-full px-5 py-3 text-sm font-black shadow-2xl ${
          toast.milestone
            ? "bg-brand text-white ring-4 ring-brand/25"
            : "bg-accent-yellow text-zinc-900"
        }`}
      >
        <span className="text-lg" aria-hidden>{toast.milestone ? "🎉" : "🔥"}</span>
        {toast.text}
      </div>
    </div>
  );
}
