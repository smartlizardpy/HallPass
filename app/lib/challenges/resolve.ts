/**
 * HallPass — what it means to BEAT a challenge.
 *
 * PURE AND CLOCK-FREE, in the manner of `streak/core.ts`, `badges.ts` and
 * `beta/xp.ts`: no `Date.now()`, no database, no `window`. Every function takes
 * what it needs as an argument, so the whole rule unit-tests in the plain `node`
 * environment and cannot drift with the clock.
 *
 * ── WHY THIS EXISTS WHEN THE UPDATE IS ONE SQL STATEMENT ────────────────────
 * Resolution itself happens in a single `UPDATE … FROM boards … RETURNING`
 * (there are no cross-statement transactions on the Neon HTTP driver, so it has
 * to). That statement necessarily restates the comparison in SQL. This module is
 * the ORIGINAL of that rule, for three reasons:
 *
 *   1. The UI needs it. "Beat 4,200" and "you need 4,201" are the same fact as
 *      the WHERE clause, and computing them separately is how the screen ends up
 *      promising something the server will not honour.
 *   2. It is testable. A predicate buried in a template literal is asserted only
 *      by string-matching the SQL, which passes just as happily when the rule is
 *      wrong.
 *   3. Ties are the kind of decision that gets "tidied". `>` quietly becoming
 *      `>=` is a one-character change that silently rewrites who won.
 *
 * The SQL predicate in `store.ts` mirrors {@link beats} and says so at the call
 * site. This is the same hand-mirrored arrangement `config.ts` has with the
 * CHECK constraints in `022_challenges.sql`, and it is held together the same
 * way: a pointed comment on both halves, plus the tests below.
 *
 * ── SORT DIRECTION IS THE BOARD'S FACT, NOT THE CHALLENGE'S ─────────────────
 * `asc` boards are time/golf, where LOWER wins. That belongs to the board, so it
 * is passed in per call rather than snapshotted onto the challenge row — a board
 * whose direction is corrected must not leave old challenges scoring backwards.
 */

import type { SortDir } from "@/sdk/src/contract";

/**
 * Everything {@link resolvedBy} needs about one open challenge.
 *
 * `sort` arrives from the joined board. The window is nullable and is `null` on
 * every `friend` challenge — only the (unbuilt) `seasonal` kind sets it.
 */
export type ResolvableChallenge = {
  id: number;
  targetScore: number;
  sort: SortDir;
  /** Inclusive lower bound, ISO. `null` for no lower bound. */
  startsAt: string | null;
  /** EXCLUSIVE upper bound, ISO. `null` for no upper bound. */
  endsAt: string | null;
};

/**
 * Does `score` beat `targetScore` on a board sorted this way?
 *
 * STRICTLY. Matching the score is not beating it — a tie leaves the challenge
 * open, which is the honest reading of "beat my score" and avoids the worse
 * alternative of both players believing they won.
 */
export function beats(
  score: number,
  targetScore: number,
  sort: SortDir,
): boolean {
  if (!Number.isFinite(score) || !Number.isFinite(targetScore)) return false;
  return sort === "asc" ? score < targetScore : score > targetScore;
}

/**
 * The lowest score that would win, for the UI to show as a goal.
 *
 * Scores are `BIGINT` and the submit path truncates to an integer
 * (`leaderboard/[slug]/route.ts` does `Math.trunc` before insert), so ±1 is the
 * real next value rather than an approximation of one.
 */
export function scoreToBeat(targetScore: number, sort: SortDir): number {
  return sort === "asc" ? targetScore - 1 : targetScore + 1;
}

/**
 * Is `nowIso` inside this challenge's window?
 *
 * Lower bound inclusive, upper bound EXCLUSIVE, so a month-long challenge ending
 * at midnight on the 1st does not overlap the one starting at the same instant.
 * A `null` bound is no bound, which is every `friend` challenge — so this
 * returns `true` for them without a special case, which is exactly the property
 * that lets resolution stay kind-agnostic.
 *
 * An unparsable bound reads as CLOSED rather than open: a corrupt window must
 * not silently become an eternal challenge.
 */
export function isWithinWindow(
  challenge: Pick<ResolvableChallenge, "startsAt" | "endsAt">,
  nowIso: string,
): boolean {
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) return false;

  if (challenge.startsAt !== null) {
    const from = Date.parse(challenge.startsAt);
    if (Number.isNaN(from) || now < from) return false;
  }
  if (challenge.endsAt !== null) {
    const until = Date.parse(challenge.endsAt);
    if (Number.isNaN(until) || now >= until) return false;
  }
  return true;
}

/**
 * Which of these open challenges does `score` resolve, at `nowIso`?
 *
 * Returns ids, in the order given. The caller has already narrowed to challenges
 * this player is the target of on this board; this decides only whether the
 * score is good enough and the window is live.
 *
 * NOTE WHAT IS *NOT* CHECKED: `acceptedAt`. Accepting is a signal to the
 * challenger, never a gate — gating on it would mean beating the score after
 * launching the game from the catalogue did not count. See `022_challenges.sql`.
 *
 * Kind is not checked either, and that is the seam working: a seasonal
 * challenge with a live window resolves through this same call with no branch.
 */
export function resolvedBy(
  score: number,
  challenges: readonly ResolvableChallenge[],
  nowIso: string,
): number[] {
  const won: number[] = [];
  for (const challenge of challenges) {
    if (!beats(score, challenge.targetScore, challenge.sort)) continue;
    if (!isWithinWindow(challenge, nowIso)) continue;
    won.push(challenge.id);
  }
  return won;
}
