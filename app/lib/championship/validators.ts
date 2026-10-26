/**
 * HallPass — per-game run validators for Fright Fest 2026. Pure functions.
 *
 * WHAT THE SERVER CAN AND CANNOT KNOW. Every game here runs entirely in the
 * browser, so the score, the game's own timers and its own flags are claims. The
 * one thing the server measures itself is how much REAL time passed between
 * issuing the run token and receiving the result (`elapsedSec`, database clock).
 * The checks below therefore come in two strengths:
 *
 *   - REJECT: impossible on the server's own evidence or the published rules (a
 *     clock that ran faster than real time, the wrong school, a score off the
 *     scale). Never ranked, kept for the audit trail.
 *   - FLAG: implausible on the game's own claims (its timers disagree with its
 *     score, it reported its own warning flags). Hidden until an admin looks.
 *
 * A modified client that waits a plausible time and posts a plausible score
 * passes both. That is the limit of client-side games, stated on the rules page;
 * the backstop is admin review of the top results before finalising.
 *
 * Network latency is real: the token request can arrive several seconds after
 * the run clock started, so every "faster than real time" comparison allows
 * `LATENCY_SLACK_SEC`.
 */

import type { ValidationInput, ValidationResult } from "./types";

export const EVENT_ID = "fright-fest-2026";
/** Allowance for the token request and the submission taking different times to arrive. */
export const LATENCY_SLACK_SEC = 8;

type Checks = Record<string, number | string | boolean | null>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

function clientFlags(meta: Record<string, unknown>): string[] {
  const f = meta.flags;
  if (!Array.isArray(f)) return [];
  return f.filter((x): x is string => typeof x === "string").slice(0, 10);
}

function reject(reason: string, checks: Checks): ValidationResult {
  return { ok: false, reason, checks };
}

// ── Last Bell — The Halloween Shift (VERIFIED) ──────────────────────────────
//
// Contract: ~/Documents/Projects/last-bell/docs/halloween/hallpass-request.md
// and halloween/score.js. One fixed school (seed 2026118), Normal, solo, an 8:00
// clock. Score = whole seconds left at the escape (higher is better). `meta.time`
// is game seconds from the first playing frame to the escape and advances in the
// same frame as the clock, so it equals `480 − score` to within rounding.

export const LAST_BELL = {
  clock: 480,
  seed: 2026118,
  /** The straight-line route for the event school at sprint speed (_dev/hw-seed-scan.mjs). */
  routeFloorSec: 26,
  /** `meta.time` vs the clock: rounding is ±0.5 s, so 3 s means something else happened. */
  timeToleranceSec: 3,
  /** The game's own "game time ran faster than wall time" margin. */
  wallToleranceSec: 2,
} as const;

export function validateLastBell({ score, meta, elapsedSec, startSeed }: ValidationInput): ValidationResult {
  const s = int(score);
  const time = num(meta.time);
  const wall = num(meta.wall);
  const bound = num(meta.bound);
  const seed = int(meta.seed);
  const used = s === null ? null : LAST_BELL.clock - s;
  const checks: Checks = {
    elapsedSec: round2(elapsedSec),
    clockUsedSec: used,
    gameTimeSec: time === null ? null : round2(time),
    wallTimeSec: wall === null ? null : round2(wall),
    routeBoundSec: bound === null ? null : round2(bound),
    seed,
  };

  if (s === null || s < 0 || s > LAST_BELL.clock) return reject("bad-score", checks);
  if (meta.event !== EVENT_ID) return reject("wrong-event", checks);
  if (seed !== LAST_BELL.seed || (startSeed !== null && startSeed !== LAST_BELL.seed)) {
    return reject("wrong-school", checks);
  }
  const usedSec = LAST_BELL.clock - s;
  if (usedSec < LAST_BELL.routeFloorSec) return reject("faster-than-route", checks);
  if (usedSec > elapsedSec + LATENCY_SLACK_SEC) return reject("clock-faster-than-real-time", checks);

  const flags: string[] = [];
  const own = clientFlags(meta);
  if (own.length) flags.push(...own.map((f) => `game:${f}`));
  if (time === null) flags.push("no-game-time");
  else if (Math.abs(time - usedSec) > LAST_BELL.timeToleranceSec) flags.push("game-time-mismatch");
  if (time !== null && wall !== null && wall < time - LAST_BELL.wallToleranceSec) flags.push("game-time-ahead-of-wall");
  if (bound !== null && usedSec < bound * 0.9) flags.push("faster-than-game-route");

  return {
    ok: true,
    score: s,
    // Escape time in game seconds (2 dp) breaks ties between equal whole seconds
    // left; the clock is the fallback if the game sent no time (and is flagged).
    tiebreak: time === null ? usedSec : round2(time),
    flags,
    checks,
  };
}

// ── Shadow Core: Halloween Dash — Cursed Dash (PROPOSED) ────────────────────
//
// The game has no such mode yet (docs/championship-design.md §2.2). Proposed:
// all 15 sectors in one continuous run, total time in ms (lower is better),
// per-sector splits and deaths in `meta`. The board stays `pending` until the
// game sends exactly this and an admin opens it.

export const SHADOW_CORE = {
  sectors: 15,
  /** Hard floor: 2 s per sector. Real data should raise it. */
  minTotalMs: 30_000,
  /** Below this a run is held for review until real times are known. */
  reviewBelowMs: 90_000,
  maxTotalMs: 3_600_000,
  splitToleranceMs: 15,
} as const;

export function validateShadowCoreCursedDash({ score, meta, elapsedSec }: ValidationInput): ValidationResult {
  const s = int(score);
  const deaths = int(meta.deaths);
  const splits = Array.isArray(meta.splits) ? meta.splits.map(int) : null;
  const sum = splits && splits.every((x) => x !== null && x >= 0) ? (splits as number[]).reduce((a, b) => a + b, 0) : null;
  const checks: Checks = {
    elapsedSec: round2(elapsedSec),
    totalMs: s,
    splitCount: splits ? splits.length : null,
    splitSumMs: sum,
    deaths,
  };

  if (s === null || s < SHADOW_CORE.minTotalMs || s > SHADOW_CORE.maxTotalMs) return reject("bad-score", checks);
  if (meta.event !== EVENT_ID) return reject("wrong-event", checks);
  if (meta.mode !== "cursed-dash") return reject("wrong-mode", checks);
  if (s / 1000 > elapsedSec + LATENCY_SLACK_SEC) return reject("clock-faster-than-real-time", checks);
  if (splits && splits.length === SHADOW_CORE.sectors && sum !== null && Math.abs(sum - s) > SHADOW_CORE.splitToleranceMs) {
    return reject("splits-do-not-add-up", checks);
  }

  const flags: string[] = clientFlags(meta).map((f) => `game:${f}`);
  if (!splits || splits.length !== SHADOW_CORE.sectors || sum === null) flags.push("no-splits");
  if (deaths === null || deaths < 0) flags.push("no-deaths");
  if (s < SHADOW_CORE.reviewBelowMs) flags.push("unusually-fast");

  return { ok: true, score: s, tiebreak: deaths !== null && deaths >= 0 ? deaths : null, flags, checks };
}

// ── Survive Till Dawn: Pixel Edition — Blood Moon (PROPOSED) ────────────────
//
// The game has no such mode and submits no scores yet (§2.3). Proposed: Bleeding
// Woods, Standard, a 20-minute night, solo, seeded, no permanent upgrades. Score
// = whole seconds survived (higher is better, 1200 = dawn); kills break ties.

export const SURVIVE_TILL_DAWN = {
  nightSec: 1200,
  /** Generous ceiling until real runs are seen: a kill rate above this is reviewed. */
  reviewKillsPerSec: 15,
} as const;

export function validateSurviveTillDawnBloodMoon({ score, meta, elapsedSec }: ValidationInput): ValidationResult {
  const s = int(score);
  const kills = int(meta.kills);
  const checks: Checks = { elapsedSec: round2(elapsedSec), survivedSec: s, kills, coop: meta.coop === true };

  if (s === null || s < 0 || s > SURVIVE_TILL_DAWN.nightSec) return reject("bad-score", checks);
  if (meta.event !== EVENT_ID) return reject("wrong-event", checks);
  if (meta.mode !== "blood-moon") return reject("wrong-mode", checks);
  if (meta.coop === true) return reject("co-op-not-ranked", checks);
  if (s > elapsedSec + LATENCY_SLACK_SEC) return reject("clock-faster-than-real-time", checks);

  const flags: string[] = clientFlags(meta).map((f) => `game:${f}`);
  if (kills === null || kills < 0) flags.push("no-kills");
  else if (s > 0 && kills / s > SURVIVE_TILL_DAWN.reviewKillsPerSec) flags.push("unusual-kill-rate");

  return { ok: true, score: s, tiebreak: kills !== null && kills >= 0 ? kills : null, flags, checks };
}
