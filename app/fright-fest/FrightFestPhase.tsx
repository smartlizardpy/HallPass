"use client";

import { useSyncExternalStore } from "react";
import { FRIGHT_FEST_THEME } from "../lib/events/fright-fest";
import { eventDateLabels } from "../lib/events/labels";
import { phaseAt } from "../lib/events/phase";

const L = eventDateLabels(FRIGHT_FEST_THEME);

/**
 * The only clock-dependent part of /fright-fest. The server and the first client
 * render both use the neutral snapshot ("neutral"), which is correct for every
 * phase; after hydration the client snapshot refines it. The page stays static.
 */
const subscribe = () => () => {};
const clientPhase = () => phaseAt(FRIGHT_FEST_THEME, Date.now());
const serverPhase = () => "neutral" as const;

export function FrightFestPhase() {
  const phase = useSyncExternalStore(subscribe, clientPhase, serverPhase);
  const text =
    phase === "live"
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
