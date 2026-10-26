/**
 * The opening as an explicit state machine (docs/collectibles-opening.md §3).
 * Pure: a reducer and a few helpers, no IO, no timers, so every transition is
 * testable and an animation callback can never do more than ask for one.
 *
 *   loading → sealed ⇄ tearing → committing → opened → extracting → revealing → summary
 *
 * THE SERVER IS NOT CALLED FROM HERE. The flow calls it exactly once, from the
 * commit handler, guarded by an in-flight ref and by `canCommit`; this machine
 * only records what the answer was. Every event that arrives in a stage that
 * does not expect it is ignored, so a late animation callback, a double click or
 * a pointerup racing a keypress cannot move the opening twice.
 */

import { getCollectible } from "@/app/lib/collectibles/catalogue";
import { RARITY_RANK } from "@/app/lib/collectibles/present";

export type Pull = { slot: number; collectibleId: string; wasNew: boolean };
export type SealedPack = { publicId: string; packId: string; packVersion: number };
export type Failure = "signed-out" | "missing" | "revoked" | "error";
export type Stage = "loading" | Failure | "sealed" | "tearing" | "committing" | "opened" | "extracting" | "revealing" | "summary";

export interface OpeningState {
  stage: Stage;
  pack: SealedPack | null;
  /** In REVEAL order (rarest last), not slot order. */
  pulls: Pull[];
  /** Turned over: the flip has started (the face is coming). */
  flipped: boolean[];
  /** The flip and its rarity moment have finished. */
  settled: boolean[];
  /** Phones: the card in front of the stack. */
  current: number;
  /** The pack was already open when this page loaded (a refresh, a second device). */
  resumed: boolean;
  /** Skip was pressed before the cards were out: go straight to the summary when they are. */
  skipping: boolean;
  /** A retryable failure, shown over the sealed pack. */
  notice: string | null;
}

export type OpeningEvent =
  | { type: "loaded-sealed"; pack: SealedPack }
  | { type: "loaded-opened"; pack: SealedPack; pulls: Pull[]; flipped: boolean[] | null; done: boolean }
  | { type: "load-failed"; failure: Failure }
  | { type: "retry" }
  | { type: "tear-start" }
  | { type: "tear-cancel" }
  | { type: "commit" }
  | { type: "open-ok"; pulls: Pull[] }
  | { type: "open-failed"; failure: Failure | "retryable" }
  | { type: "loosened" }
  | { type: "extracted" }
  | { type: "flip"; index: number }
  | { type: "flip-done"; index: number }
  | { type: "next" }
  | { type: "finish" }
  | { type: "skip" };

export const RETRY_NOTICE = "That didn't go through. Your pack is safe and still sealed: try again.";

export function initialOpening(): OpeningState {
  return { stage: "loading", pack: null, pulls: [], flipped: [], settled: [], current: 0, resumed: false, skipping: false, notice: null };
}

/** Rarest last, stable by slot: the real contents in the order they are turned over. */
export function revealOrder(pulls: Pull[]): Pull[] {
  const rank = (p: Pull) => {
    const c = getCollectible(p.collectibleId);
    return c ? RARITY_RANK[c.rarity] : 0;
  };
  return [...pulls].sort((a, b) => rank(a) - rank(b) || a.slot - b.slot);
}

/** Whether a commit (tear finished, Open pressed) may call the server now. */
export const canCommit = (s: OpeningState) => s.stage === "sealed" || s.stage === "tearing";
/** Whether Skip means anything now. */
export const canSkip = (s: OpeningState) => ["committing", "opened", "extracting", "revealing"].includes(s.stage);
const allTrue = (xs: boolean[]) => xs.length > 0 && xs.every(Boolean);
const firstFalse = (xs: boolean[], from = 0) => {
  for (let i = from; i < xs.length; i++) if (!xs[i]) return i;
  for (let i = 0; i < from; i++) if (!xs[i]) return i;
  return Math.max(0, xs.length - 1);
};

function toSummary(s: OpeningState): OpeningState {
  return { ...s, stage: "summary", flipped: s.pulls.map(() => true), settled: s.pulls.map(() => true), current: Math.max(0, s.pulls.length - 1), skipping: false };
}

export function openingReducer(s: OpeningState, e: OpeningEvent): OpeningState {
  switch (e.type) {
    case "loaded-sealed":
      return s.stage === "loading" ? { ...s, stage: "sealed", pack: e.pack } : s;

    case "loaded-opened": {
      if (s.stage !== "loading") return s;
      const pulls = revealOrder(e.pulls);
      const flipped = e.flipped && e.flipped.length === pulls.length ? e.flipped : pulls.map(() => false);
      const base = { ...s, pack: e.pack, pulls, flipped, settled: flipped, resumed: true, current: firstFalse(flipped) };
      return e.done || allTrue(flipped) ? toSummary(base) : { ...base, stage: "revealing" };
    }

    case "load-failed":
      return s.stage === "loading" ? { ...s, stage: e.failure } : s;

    case "retry":
      return s.stage === "error" ? initialOpening() : s;

    case "tear-start":
      return s.stage === "sealed" ? { ...s, stage: "tearing", notice: null } : s;

    case "tear-cancel":
      return s.stage === "tearing" ? { ...s, stage: "sealed" } : s;

    case "commit":
      return canCommit(s) ? { ...s, stage: "committing", notice: null } : s;

    case "open-ok": {
      if (s.stage !== "committing") return s;
      const pulls = revealOrder(e.pulls);
      const next = { ...s, stage: "opened" as const, pulls, flipped: pulls.map(() => false), settled: pulls.map(() => false), current: 0 };
      return s.skipping ? toSummary(next) : next;
    }

    case "open-failed":
      if (s.stage !== "committing") return s;
      return e.failure === "retryable" ? { ...s, stage: "sealed", skipping: false, notice: RETRY_NOTICE } : { ...s, stage: e.failure, skipping: false };

    case "loosened":
      return s.stage === "opened" ? { ...s, stage: "extracting" } : s;

    case "extracted":
      return s.stage === "extracting" ? { ...s, stage: "revealing" } : s;

    case "flip": {
      if (s.stage !== "revealing" || e.index < 0 || e.index >= s.pulls.length || s.flipped[e.index]) return s;
      return { ...s, flipped: s.flipped.map((v, i) => v || i === e.index), current: e.index };
    }

    case "flip-done": {
      if (s.stage !== "revealing" || !s.flipped[e.index] || s.settled[e.index]) return s;
      return { ...s, settled: s.settled.map((v, i) => v || i === e.index) };
    }

    case "next": {
      // Phones: send the settled card in front to the side, bring up the next face-down one.
      if (s.stage !== "revealing" || !s.settled[s.current]) return s;
      return allTrue(s.flipped) ? s : { ...s, current: firstFalse(s.flipped, s.current + 1) };
    }

    case "finish":
      return s.stage === "revealing" && allTrue(s.settled) ? toSummary(s) : s;

    case "skip":
      if (s.stage === "committing") return { ...s, skipping: true };
      return canSkip(s) ? toSummary(s) : s;
  }
}

/** HTTP status of the open call → what it means for the opening. */
export function openFailure(status: number): Failure | "retryable" {
  if (status === 401) return "signed-out";
  if (status === 404) return "missing";
  if (status === 410) return "revoked";
  return "retryable";
}
