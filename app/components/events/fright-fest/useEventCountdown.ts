"use client";

import { useSyncExternalStore } from "react";
import { countdownAt, type Countdown } from "../../../lib/events/countdown";
import { FRIGHT_FEST_THEME } from "../../../lib/events/fright-fest";

/**
 * The Fright Fest countdown, ticking once a second. Every countdown on the page
 * shares one module-level clock, so the hero and /fright-fest never drift apart
 * or stack timers. The server and the first client render get `null` (the clock
 * is 0 there), so static HTML stays identical for everyone; after hydration the
 * real value arrives. Reads only the theme window, never the championship.
 */
let now = 0;
const listeners = new Set<() => void>();
let timer: number | undefined;

function subscribe(cb: () => void) {
  listeners.add(cb);
  now = Date.now();
  if (listeners.size === 1) {
    timer = window.setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) window.clearInterval(timer);
  };
}
const snapshot = () => now;
const serverSnapshot = () => 0;

export function useEventCountdown(): Countdown | null {
  const t = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return t ? countdownAt(FRIGHT_FEST_THEME, t) : null;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");
