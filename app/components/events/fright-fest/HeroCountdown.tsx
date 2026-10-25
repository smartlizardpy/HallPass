"use client";

import { pad2, useEventCountdown } from "./useEventCountdown";

/**
 * The hero's small countdown, beside the call to action. The cells are always
 * in the HTML (dashes until the clock arrives), so the hero's copy never moves
 * when the digits fill in: same box, new text. The ticking digits are hidden
 * from assistive tech; the sentence after them is read instead.
 */
export function HeroCountdown() {
  const c = useEventCountdown();
  const cells: [number | undefined, string][] = [
    [c?.d, "d"],
    [c?.h, "h"],
    [c?.m, "m"],
    [c?.s, "s"],
  ];
  return (
    <div className="ha-count" data-testid="ha-countdown" data-ff-to={c?.to}>
      <p className="ha-count-k">{c?.to === "end" ? "Ends in" : "Opens in"}</p>
      <p className="ha-count-n" aria-hidden="true">
        {cells.map(([v, l]) => (
          <span key={l} className="ha-count-c">
            <b>{v === undefined ? "--" : pad2(v)}</b>
            <i>{l}</i>
          </span>
        ))}
      </p>
      {c && (
        <p className="sr-only">
          {c.d} days {c.h} hours {c.m} minutes
        </p>
      )}
    </div>
  );
}
