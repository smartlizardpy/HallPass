"use client";

/**
 * The marquee's ticker plate: where the championship is, and the countdown.
 * It carries the page's two test hooks:
 *
 *  - `data-testid="ff-phase"` with `data-ff-phase` (the skin's clock phase:
 *    neutral / preview / live / ended / off, exactly as the old phase line had);
 *  - `data-testid="ff-countdown"` with `data-ff-to` (start / end).
 *
 * The server and the first client render are the same for everyone (the date
 * range, no countdown, "neutral"); the clock arrives after hydration, so the page
 * stays static.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEventCountdown } from "@/app/components/events/fright-fest/useEventCountdown";
import { opensAtMs } from "@/app/lib/events/countdown";
import { FRIGHT_FEST_THEME } from "@/app/lib/events/fright-fest";
import { phaseAt } from "@/app/lib/events/phase";
import { PHONE_BELOW_PX, DESK, PHONE, placeVars } from "./geometry";
import { countdownText, tickerCountdownLabel, tickerLine } from "./logic";
import { useHall } from "./HallProvider";

const subscribe = () => () => {};
/** "preview": the skin is painting but the event itself has not opened yet. */
const clientPhase = () => {
  const now = Date.now();
  const phase = phaseAt(FRIGHT_FEST_THEME, now);
  return phase === "live" && now < opensAtMs(FRIGHT_FEST_THEME) ? "preview" : phase;
};
const serverPhase = () => "neutral" as const;

export function Ticker() {
  const { phase, summary } = useHall();
  const themePhase = useSyncExternalStore(subscribe, clientPhase, serverPhase);
  const c = useEventCountdown();
  const ref = useRef<HTMLParagraphElement>(null);
  const [compact, setCompact] = useState(false);

  // The phone's plate is narrower, so it gets the shorter words. The room is a
  // container, so ask the room, not the window.
  useEffect(() => {
    const room = ref.current?.closest(".hl");
    if (!room || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setCompact(e.contentRect.width < PHONE_BELOW_PX));
    ro.observe(room);
    return () => ro.disconnect();
  }, []);

  const line = tickerLine(phase, summary, compact);
  const label = tickerCountdownLabel(line, !!summary, c?.to ?? null);

  return (
    <p
      ref={ref}
      className="hl-ticker"
      data-tone={line.tone}
      data-testid="ff-phase"
      data-ff-phase={themePhase}
      title={line.text}
      style={placeVars(DESK.ticker, PHONE.ticker)}
    >
      <span className="hl-ticker-text">{line.text}</span>
      {label && c && (
        <span data-testid="ff-countdown" data-ff-to={c.to} className="hl-ticker-count">
          <span aria-hidden="true">
            {label} {countdownText(c)}
          </span>
          <span className="sr-only">
            {` ${label} ${c.d} ${c.d === 1 ? "day" : "days"} ${c.h} ${c.h === 1 ? "hour" : "hours"} ${c.m} ${c.m === 1 ? "minute" : "minutes"}`}
          </span>
        </span>
      )}
    </p>
  );
}
