/**
 * HallPass — what a championship admin may do right now. Pure.
 *
 * The store's SQL guards the STORED state (no double suspend, no finalising
 * outside verification, no review after finalisation). The rules that depend on
 * the CLOCK live here, evaluated with the database clock from the snapshot the
 * action reads first: verification only once the finishing grace is over (so no
 * run in flight is cut off), reopening only before the scheduled close, closing
 * early only while the event is live. The dashboard uses the same answers to
 * show, hide and explain its buttons, so a button is never offered that the
 * action would refuse.
 */

import { championshipPhase, closeAtMs } from "./phase";
import type { EventAction } from "./store";
import type { ChampionshipConfig, EventState } from "./types";

export type Allowed = { ok: true } | { ok: false; why: string };

const yes: Allowed = { ok: true };
const no = (why: string): Allowed => ({ ok: false, why });

/** When the finishing grace ends: the earliest moment verification may start. */
export function graceEndsAtMs(c: ChampionshipConfig, state: EventState): number {
  return closeAtMs(c, state) + c.submitGraceSec * 1000;
}

export function eventActionAllowed(
  c: ChampionshipConfig,
  state: EventState,
  nowMs: number,
  action: EventAction | "finalise",
  flaggedRuns: number,
): Allowed {
  const phase = championshipPhase(c, state, nowMs);
  const final = state.status === "finalised" || state.status === "archived";
  switch (action) {
    case "suspend":
      if (final) return no("The results are already final.");
      return state.suspended ? no("Already suspended.") : yes;
    case "resume":
      return state.suspended ? yes : no("Not suspended.");
    case "close-early":
      if (state.status !== "scheduled") return no("Submissions are already closed.");
      if (state.closedEarlyAt) return no("Already closed early.");
      return phase === "live" ? yes : no("Only a live event can be closed early.");
    case "reopen":
      if (!state.closedEarlyAt || state.status !== "scheduled") return no("Nothing to reopen.");
      return nowMs < Date.parse(c.closesAt) ? yes : no("The scheduled close has passed; reopening would extend the event.");
    case "start-verification":
      if (state.status !== "scheduled") return no("Verification has already started.");
      if (nowMs < graceEndsAtMs(c, state)) return no("Runs started before the close may still be finishing. Wait for the grace to end.");
      return yes;
    case "finalise":
      if (state.status !== "verification") return no("Start verification first.");
      if (state.suspended) return no("Resume the event first.");
      return flaggedRuns > 0 ? no(`${flaggedRuns} run${flaggedRuns === 1 ? " is" : "s are"} still waiting for review.`) : yes;
    case "archive":
      return state.status === "finalised" ? yes : no("Only a finalised event can be archived.");
  }
}
