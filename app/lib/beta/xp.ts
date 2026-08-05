/**
 * HallPass — beta XP arithmetic and rank progression.
 *
 * Pure and dependency-free, like `badges.ts`: no `server-only`, no database, no
 * React. The triage action calls {@link xpForReport} to decide an award, and the
 * tester's own page calls {@link rankFor} to draw the meter — sharing this module
 * is what stops the number a tester is promised from differing from the number
 * they are paid.
 *
 * WHY XP IS COMPUTED, NEVER STORED AS A TOTAL. A player's XP is
 * `sum(beta_xp_awards.amount)`, always. A cached total on `beta_testers` would
 * be a second source of truth that drifts the first time an award is reversed,
 * and the ledger is tiny — a few rows per tester. `achievements/store.ts` takes
 * exactly the same position with `pointsForPlayer`.
 */

import {
  BUG_XP,
  COVER_PROMOTION_XP,
  DUPLICATE_XP,
  FEATURE_XP,
  RANKS,
  REJECTED_XP,
  SHOT_XP,
  type BugSeverity,
  type RankName,
  type ReportKind,
  type ReportStatus,
} from "./config";

/**
 * XP owed for a report reaching `status`.
 *
 * Returns 0 for `open` as well as `rejected`: an untriaged report has earned
 * nothing YET, and collapsing both to zero means the caller never has to special-
 * case "not decided" separately from "decided against". The award is written
 * once, when triage moves the row out of `open`.
 *
 * `severity` is ignored for `feature` reports and REQUIRED for accepted bugs —
 * a bug accepted without one is a triage bug, not a free 100 XP, so it pays the
 * lowest band rather than throwing (a throw here would roll back the admin's
 * whole triage action over a missing dropdown).
 */
export function xpForReport(report: {
  kind: ReportKind;
  severity: BugSeverity | null;
  status: ReportStatus;
}): number {
  switch (report.status) {
    case "open":
    case "rejected":
      return REJECTED_XP;
    case "duplicate":
      return DUPLICATE_XP;
    case "accepted":
      if (report.kind === "feature") return FEATURE_XP;
      return report.severity ? BUG_XP[report.severity] : BUG_XP.cosmetic;
  }
}

/**
 * XP owed for an accepted image, plus the cover bonus when it is promoted.
 *
 * Additive rather than a separate scale so a promotion can be awarded LATER,
 * as a second ledger row, without recomputing or reversing the first.
 */
export function xpForShot(options: { promotedToCover: boolean }): number {
  return SHOT_XP + (options.promotedToCover ? COVER_PROMOTION_XP : 0);
}

/** A tester's standing on the rank ladder, ready to render. */
export type RankProgress = {
  name: RankName;
  /** XP at which the current rank starts. */
  min: number;
  /** The next rank, or `null` at the top of the ladder. */
  next: { name: RankName; min: number } | null;
  /** XP still needed for `next`, or `0` at the top. */
  toNext: number;
  /**
   * Progress through the CURRENT band, 0–1. Exactly `1` at the top rank so a
   * meter reads "complete" rather than sitting at an arbitrary fraction.
   */
  fraction: number;
};

/**
 * Where `xp` sits on the ladder.
 *
 * Scans from the top down so the first match wins; negative or non-finite input
 * clamps to 0 rather than falling off the bottom, because this is called with a
 * database sum that is empty (`null` → 0) for every tester on their first day.
 */
export function rankFor(xp: number): RankProgress {
  const total = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;

  let index = 0;
  for (let i = RANKS.length - 1; i >= 0; i -= 1) {
    if (total >= RANKS[i].min) {
      index = i;
      break;
    }
  }

  const current = RANKS[index];
  const next = index < RANKS.length - 1 ? RANKS[index + 1] : null;

  if (!next) {
    return { name: current.name, min: current.min, next: null, toNext: 0, fraction: 1 };
  }

  const span = next.min - current.min;
  return {
    name: current.name,
    min: current.min,
    next: { name: next.name, min: next.min },
    toNext: next.min - total,
    // `span` is always > 0 for a well-formed ladder, which `xp.test.ts` asserts.
    fraction: Math.min(1, Math.max(0, (total - current.min) / span)),
  };
}
