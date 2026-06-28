"use client";

/**
 * Slide-down welcome banner shown once right after sign-in.
 *
 * `/auth/landing` redirects to the destination with `?welcome=back` (returning)
 * or `?welcome=new` (first time). On mount we read that flag, strip it from the
 * URL (so a refresh won't replay the animation), fetch the player's name+avatar
 * from `/api/v1/me`, then slide a small horizontal pill down from the top:
 * "Welcome[ back], <name>!" with the avatar on the left. It auto-dismisses.
 *
 * Mounted once in the root layout, so it works on both the arcade home and the
 * dashboard. Reads `window.location` directly (not `useSearchParams`) to avoid a
 * Suspense boundary and to keep the static pages static.
 */

import { useEffect, useState } from "react";
import type { MeResponse } from "@/sdk/src/contract";

type Toast = { name: string; image: string | null; returning: boolean };

export function WelcomeToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const welcome = params.get("welcome");
    if (welcome !== "back" && welcome !== "new") return;

    // Strip ?welcome so a manual refresh doesn't replay the toast.
    params.delete("welcome");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
    );

    let active = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    fetch("/api/v1/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MeResponse | null) => {
        if (!active || !d?.player) return;
        setToast({
          name: d.player.handle,
          image: d.player.image,
          returning: welcome === "back",
        });
        // Next frame → trigger the slide-in transition.
        requestAnimationFrame(() => active && setShown(true));
        timers.push(setTimeout(() => active && setShown(false), 4200));
        timers.push(setTimeout(() => active && setToast(null), 4800));
      })
      .catch(() => {});

    return () => {
      active = false;
      timers.forEach(clearTimeout);
    };
  }, []);

  if (!toast) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center px-4"
    >
      <div
        className={`mt-3 flex items-center gap-3 rounded-full border border-border bg-white/95 py-1.5 pl-1.5 pr-5 shadow-xl backdrop-blur transition-all duration-500 ease-out ${
          shown ? "translate-y-0 opacity-100" : "-translate-y-20 opacity-0"
        }`}
      >
        {toast.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={toast.image}
            alt=""
            width={40}
            height={40}
            referrerPolicy="no-referrer"
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 font-black text-brand">
            {toast.name[0]?.toUpperCase()}
          </span>
        )}
        <span className="text-sm font-extrabold text-zinc-900">
          {toast.returning ? "Welcome back" : "Welcome"}, {toast.name}!
        </span>
      </div>
    </div>
  );
}
