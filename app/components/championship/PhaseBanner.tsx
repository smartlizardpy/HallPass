"use client";

/**
 * Where the championship is, in one line. The server's phase (which knows about
 * suspension, an early close and finalisation) once it arrives; the clock's
 * until then; nothing at all in the prerendered HTML, which is identical for
 * every visitor and every date.
 */

import { clockPhase, phaseLine, type ChampionshipSummary } from "@/app/lib/championship/summary";
import { useChampionship, useMinute } from "./data";

export function PhaseBanner({ summary: s }: { summary: ChampionshipSummary }) {
  const { data } = useChampionship(s.id);
  const now = useMinute();
  const phase = data?.available ? data.phase : now === null ? null : clockPhase(s, now);
  const line = phase ? phaseLine(s, phase) : "";
  return (
    <p
      data-testid="championship-phase"
      data-phase={phase ?? "neutral"}
      className={`min-h-[3.25rem] rounded-2xl border px-4 py-3 text-sm font-bold ${
        phase === "suspended" ? "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "border-border bg-surface"
      }`}
    >
      {line || `${s.title}: ranked runs from ${s.labels.opens} to ${s.labels.lastMinute} UK time.`}
    </p>
  );
}
