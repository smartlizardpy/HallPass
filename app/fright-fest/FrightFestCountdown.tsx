"use client";

import { useSyncExternalStore } from "react";
import { countdownAt } from "../lib/events/countdown";
import { FRIGHT_FEST_THEME } from "../lib/events/fright-fest";

/**
 * Counts down to the opening, then to the close. The only ticking part of
 * /fright-fest: the server and first client render are empty, so the static page
 * is identical for everyone; after hydration a shared one-second clock drives it.
 * Hidden from assistive tech while it ticks (a live region that updates every
 * second would be noise); the phase line next to it carries the meaning.
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

const pad = (n: number) => String(n).padStart(2, "0");

export function FrightFestCountdown() {
  const t = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const c = t ? countdownAt(FRIGHT_FEST_THEME, t) : null;
  if (!c) return null;
  const cells: [number, string][] = [
    [c.d, "days"],
    [c.h, "hrs"],
    [c.m, "min"],
    [c.s, "sec"],
  ];
  return (
    <div className="ff-count" data-testid="ff-countdown" data-ff-to={c.to}>
      <p className="ff-count-k text-sm font-bold uppercase tracking-widest">
        {c.to === "start" ? "Fright Fest opens in" : "Fright Fest ends in"}
      </p>
      <p className="ff-count-n" aria-hidden="true">
        {cells.map(([v, l]) => (
          <span key={l} className="ff-count-c">
            <b>{pad(v)}</b>
            <i>{l}</i>
          </span>
        ))}
      </p>
      <p className="sr-only">
        {c.d} days {c.h} hours {c.m} minutes
      </p>
    </div>
  );
}
