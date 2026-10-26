/**
 * "The next place up, 13th, is 15 Fright Points ahead." One line for "Your Fright
 * Fest", only while the table can still move (live). Pure: given the public
 * overall table, your rank and points, and the phase.
 */

import { ordinal } from "./format";
import type { PublicOverallEntry } from "./standings";
import type { ChampionshipPhase } from "./types";

export function gapToNextPlace(overall: readonly PublicOverallEntry[], me: { rank: number; points: number } | null, phase: ChampionshipPhase | null): string | null {
  if (!me || phase !== "live" || me.rank <= 1) return null;
  const above = overall.filter((e) => e.rank < me.rank);
  const next = above.reduce<PublicOverallEntry | null>((best, e) => (!best || e.rank > best.rank ? e : best), null);
  // The public table is capped, and a place the page cannot see is not worth guessing at.
  if (!next || next.rank !== me.rank - 1) return null;
  const gap = next.points - me.points;
  if (gap > 0) return `The next place up, ${ordinal(next.rank)}, is ${gap} Fright Points ahead.`;
  return `The next place up, ${ordinal(next.rank)}, has the same Fright Points and is ahead on the tiebreak.`;
}
