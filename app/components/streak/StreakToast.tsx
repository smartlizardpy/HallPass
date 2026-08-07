"use client";

/**
 * HallPass — the streak toast.
 *
 * Listens for the streak store's advance event and briefly celebrates when a play
 * pushes the streak into a new day, with an extra flourish on a milestone. Mounted
 * once in the root layout. It fires the moment a game opens, so it deliberately
 * sits above the fullscreen player overlay (but below the panic screen).
 *
 * Purely reactive to the window event — it holds no state of its own beyond the
 * currently-showing message, so it never runs on the server and adds nothing to
 * the prerender.
 */

import { useEffect, useState } from "react";
import { STREAK_EVENT, type StreakEventDetail } from "../../lib/streak/store";

type Toast = { text: string; milestone: boolean };

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
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div
        className={`streak-toast pointer-events-auto flex items-center gap-2.5 rounded-full px-5 py-3 text-sm font-black shadow-2xl ${
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
