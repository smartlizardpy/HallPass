"use client";

/**
 * HallPass — the daily-streak flame chip for the header.
 *
 * Shows the live current streak and, on click, a small popover with the last
 * seven days and the all-time best. Always visible (even at zero) so it works as
 * a gentle call to action — "play today, keep the flame".
 *
 * Like every personalized surface on the site, it renders its empty/zero state on
 * the server and the first client paint (the streak store's server snapshot is
 * empty), then fills in after hydration — no mismatch, same pattern as the
 * favorites and recently-played rows.
 */

import { useEffect, useRef, useState } from "react";
import { dayKey, lastNDays } from "../../lib/streak/core";
import { useStreak } from "../../lib/streak/store";

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

export function StreakChip() {
  const { current, longest, days } = useStreak();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the popover on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = current > 0;
  const today = typeof window === "undefined" ? "2000-01-01" : dayKey(new Date());
  const week = lastNDays(days, today, 7);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={active ? `${current}-day streak` : "Daily streak"}
        aria-expanded={open}
        title={active ? `${current}-day streak — play today to keep it going` : "Play a game to start a streak"}
        // The chip lives on `SiteHeader`'s white bar, so the resting state fills
        // with `--surface-2`; `bg-white` would have left it invisible there. Its
        // count is `text-zinc-600` rather than `--muted` for the same reason the
        // header's placeholder is: `--muted` on `--surface-2` is 4.45:1, under
        // AA for 14px text. The lit state keeps `bg-accent-yellow`, which reads
        // against white on its own.
        className={`inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-black transition ${
          active
            ? "bg-accent-yellow text-zinc-900 hover:brightness-105"
            : "bg-surface-2 text-zinc-600 hover:text-zinc-900"
        }`}
      >
        <span aria-hidden className={active ? "" : "grayscale opacity-70"}>🔥</span>
        <span className="tabular-nums">{current}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 rounded-2xl border border-border bg-white p-4 shadow-2xl">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black tracking-tight text-zinc-900">
              {current} day{current === 1 ? "" : "s"}
            </span>
            <span className="text-lg" aria-hidden>🔥</span>
          </div>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">
            {active
              ? "Play a game every day to keep your flame alive."
              : "Play a game today to light your streak."}
          </p>

          <div className="mt-3 flex justify-between">
            {week.map((d, i) => (
              <div key={d.key} className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-bold uppercase text-muted">{WEEKDAY[i]}</span>
                <span
                  aria-hidden
                  className={`grid h-7 w-7 place-items-center rounded-full text-xs ${
                    d.played
                      ? "bg-accent-yellow text-zinc-900"
                      : d.isToday
                      ? "border-2 border-dashed border-border text-muted"
                      : "bg-surface-2 text-transparent"
                  }`}
                >
                  {d.played ? "🔥" : "·"}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-3 border-t border-border pt-2 text-[13px] font-bold text-zinc-900">
            Best: <span className="text-brand">{longest}</span> day{longest === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </div>
  );
}
