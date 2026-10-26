/**
 * HallPass — where a championship is, and whether a board takes runs. Pure.
 *
 * The single definition of both questions, shared by the intake (with the
 * DATABASE clock, so a wrong device clock can never make a late run eligible),
 * the public API, the dashboard and the client islands (with the device clock,
 * for display only). `state` is `null` when the stored row could not be read: the
 * phase then follows the clock alone, and the intake refuses runs anyway because
 * it cannot record them.
 */

import type { ChampionshipConfig, ChampionshipPhase, EventState, GameState } from "./types";

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** When submissions close: the configured close, or an earlier admin close. */
export function closeAtMs(c: ChampionshipConfig, state: EventState | null): number {
  const configured = Date.parse(c.closesAt);
  const early = ms(state?.closedEarlyAt);
  return early !== null && early < configured ? early : configured;
}

export function championshipPhase(
  c: ChampionshipConfig,
  state: EventState | null,
  nowMs: number,
): ChampionshipPhase {
  if (!c.enabled) return "off";
  const opens = Date.parse(c.opensAt);
  if (!Number.isFinite(opens) || !Number.isFinite(Date.parse(c.closesAt))) return "off";
  if (state?.status === "archived") return "archived";
  if (state?.status === "finalised") return "finalised";
  if (state?.suspended) return "suspended";
  if (nowMs < opens) return "upcoming";
  if (nowMs < closeAtMs(c, state)) return "live";
  return state?.status === "verification" ? "verification" : "closed";
}

/** Why a board will not take a run right now. */
export type NotAccepting =
  | "off"
  | "upcoming"
  | "closed"
  | "suspended"
  | "board-pending"
  | "board-paused"
  | "board-withdrawn"
  | "board-not-open-yet";

/**
 * Whether `game` takes a run at `nowMs`. Every condition must hold: the event is
 * live, the board is open, and the board's own opening has passed (a game that
 * joins later counts from its opening moment).
 */
export function boardAccepting(
  c: ChampionshipConfig,
  state: EventState | null,
  game: GameState | undefined,
  nowMs: number,
): { ok: true } | { ok: false; reason: NotAccepting } {
  const phase = championshipPhase(c, state, nowMs);
  if (phase === "off") return { ok: false, reason: "off" };
  if (phase === "suspended") return { ok: false, reason: "suspended" };
  if (phase === "upcoming") return { ok: false, reason: "upcoming" };
  if (phase !== "live") return { ok: false, reason: "closed" };
  if (!game || game.status === "pending") return { ok: false, reason: "board-pending" };
  if (game.status === "paused") return { ok: false, reason: "board-paused" };
  if (game.status === "withdrawn") return { ok: false, reason: "board-withdrawn" };
  const opened = ms(game.openedAt);
  if (opened === null || nowMs < opened) return { ok: false, reason: "board-not-open-yet" };
  return { ok: true };
}

/** Boards that count for points: every board that has opened and was not withdrawn. */
export function countingGames(games: readonly GameState[]): GameState[] {
  return games.filter((g) => (g.status === "open" || g.status === "paused") && g.openedAt !== null);
}

/** True when no board can still join, so the lineup (and Participation eligibility) is final. */
export function lineupFinal(games: readonly GameState[], phase: ChampionshipPhase): boolean {
  if (phase === "closed" || phase === "verification" || phase === "finalised" || phase === "archived") return true;
  return games.every((g) => g.status !== "pending");
}
