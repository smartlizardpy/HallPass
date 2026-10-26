"use client";

/**
 * Where the championship is, in one line. The server's phase (which knows about
 * suspension, an early close and finalisation) once it arrives; the clock's
 * until then; nothing at all in the prerendered HTML, which is identical for
 * every visitor and every date. Drawn as an LED ticker plate (sections.css).
 */

import { clockPhase, phaseLine, type ChampionshipSummary } from "@/app/lib/championship/summary";
import { useChampionship, useMinute } from "./data";

export function PhaseBanner({ summary: s }: { summary: ChampionshipSummary }) {
  const { data } = useChampionship(s.id);
  const now = useMinute();
  const phase = data?.available ? data.phase : now === null ? null : clockPhase(s, now);
  const line = phase ? phaseLine(s, phase) : "";
  // Green is live, amber is waiting or checking, lavender is over or unknown. The paused state
  // also gets a dashed edge, so it is not told apart by colour alone.
  const tone = phase === "live" ? "live" : phase === "finalised" || phase === "archived" || phase === null ? "done" : "wait";
  return (
    <p data-testid="championship-phase" data-phase={phase ?? "neutral"} data-tone={tone} className="ar-phase">
      {line || `${s.title}: ranked runs from ${s.labels.opens} to ${s.labels.lastMinute} UK time.`}
    </p>
  );
}
