"use client";

import { pad2, useEventCountdown } from "../components/events/fright-fest/useEventCountdown";

/**
 * Counts down to the opening, then to the close. The only ticking part of
 * /fright-fest: the server and first client render are empty, so the static page
 * is identical for everyone; after hydration the shared one-second clock drives it.
 * Hidden from assistive tech while it ticks (a live region that updates every
 * second would be noise); the phase line next to it carries the meaning.
 */
export function FrightFestCountdown() {
  const c = useEventCountdown();
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
            <b>{pad2(v)}</b>
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
