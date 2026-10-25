"use client";

import { useSyncExternalStore } from "react";
import { opensAtMs } from "../lib/events/countdown";
import { FRIGHT_FEST_THEME } from "../lib/events/fright-fest";
import { eventDateLabels } from "../lib/events/labels";
import { phaseAt } from "../lib/events/phase";

const L = eventDateLabels(FRIGHT_FEST_THEME);

/**
 * The only clock-dependent part of /fright-fest. The server and the first client
 * render both use the neutral snapshot ("neutral"), which is correct for every
 * phase; after hydration the client snapshot refines it. The page stays static.
 * "preview": the skin is painting but the event itself hasn't opened yet.
 */
const subscribe = () => () => {};
const clientPhase = () => {
  const now = Date.now();
  const phase = phaseAt(FRIGHT_FEST_THEME, now);
  return phase === "live" && now < opensAtMs(FRIGHT_FEST_THEME) ? "preview" : phase;
};
const serverPhase = () => "neutral" as const;

export function FrightFestPhase() {
  const phase = useSyncExternalStore(subscribe, clientPhase, serverPhase);
  const text =
    phase === "preview"
      ? `Fright Fest opens on ${L.startShort} (UK). The arcade got haunted early.`
      : phase === "live"
        ? `Fright Fest is on now. The arcade is haunted until ${L.endShort} (UK).`
        : phase === "ended"
          ? "Fright Fest 2026 has ended. Thanks for playing; the games below are still here."
          : phase === "off"
            ? `Fright Fest starts on ${L.startShort} (UK). The haunted look switches on by itself.`
            : `Fright Fest runs ${L.startShort} to ${L.endShort} (UK).`;
  return (
    <p data-testid="ff-phase" data-ff-phase={phase} className="text-base text-[var(--text-muted,inherit)]">
      {text}
    </p>
  );
}
