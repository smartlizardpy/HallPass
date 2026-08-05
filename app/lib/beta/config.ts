/**
 * HallPass — beta programme tunables.
 *
 * Mirrors `scoreboard/config.ts`, `social/config.ts`, `reviews/config.ts` and
 * `achievements/config.ts`: pure, no `server-only`, no database. Read by the
 * store, the routes, the server actions AND the client islands, so the numbers
 * cannot drift between what the UI promises and what the server awards.
 */

/** What a report is about. `feature` has no severity — see {@link BugSeverity}. */
export const REPORT_KINDS = ["bug", "feature"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/**
 * How badly a bug hurts, worst last.
 *
 * Ordered because the admin UI renders it as a scale and because
 * `xpForReport()` indexes {@link BUG_XP} by it. Deliberately four values: three
 * collapses "annoying" and "unplayable" into one bucket, and five invites
 * bikeshedding between adjacent middles that no triager can apply consistently.
 */
export const BUG_SEVERITIES = [
  "cosmetic",
  "minor",
  "major",
  "blocker",
] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

/** Where a report sits in triage. `open` is the only non-terminal state. */
export const REPORT_STATUSES = [
  "open",
  "accepted",
  "rejected",
  "duplicate",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Lifecycle of one admin-issued playtest assignment. */
export const ASSIGNMENT_STATUSES = [
  "assigned",
  "in_progress",
  "submitted",
  "closed",
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** What a submitted image is FOR. Cover candidates are judged more harshly. */
export const SHOT_KINDS = ["cover", "screenshot"] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];

/** Review state of a submitted image. */
export const SHOT_STATUSES = ["pending", "accepted", "rejected"] as const;
export type ShotStatus = (typeof SHOT_STATUSES)[number];

// ---------------------------------------------------------------------------
// XP
// ---------------------------------------------------------------------------

/**
 * XP for an ACCEPTED bug, by severity.
 *
 * The curve is deliberately steeper than linear (10 → 150). A flat rate rewards
 * volume, and volume is the failure mode of every bug bounty: twenty "the button
 * is 2px off" reports are worth less than one "this game does not start on iOS"
 * and must not out-earn it.
 *
 * The load-bearing property is `blocker > 10 × cosmetic`, so a tester cannot
 * beat one genuine find by farming trivia — `xp.test.ts` asserts it, which is
 * how the original 10/25/50/100 curve was caught paying exactly the same for
 * ten cosmetics as for a blocker.
 */
export const BUG_XP: Record<BugSeverity, number> = {
  cosmetic: 10,
  minor: 30,
  major: 75,
  blocker: 150,
};

/**
 * XP for an ACCEPTED feature request.
 *
 * Priced between `minor` and `major`: a good idea is worth real credit, but it
 * costs a tester far less to produce than a reproducible bug with a clip, and
 * pricing it at `blocker` would turn the queue into a wishlist.
 */
export const FEATURE_XP = 40;

/**
 * XP for a report closed as a DUPLICATE.
 *
 * Deliberately not zero. A duplicate is a correct observation that arrived
 * second, usually because the tester could not see the existing queue — paying
 * nothing teaches them that reporting is a lottery, and the thing they stop
 * doing is reporting. Small enough that farming duplicates is pointless.
 */
export const DUPLICATE_XP = 5;

/** XP when a submitted image is accepted into a game's gallery. */
export const SHOT_XP = 15;

/**
 * ADDITIONAL XP when an accepted image is promoted to a game's cover art.
 *
 * Stacks on top of {@link SHOT_XP}, so a promoted cover is worth 75 — the same
 * as a `major` bug. That parity is intentional: a good cover measurably changes
 * whether a game gets played at all. `xp.test.ts` pins the equality so the two
 * cannot drift apart silently when one of them is retuned.
 */
export const COVER_PROMOTION_XP = 60;

/** A rejected report earns nothing. Named so call sites read as a decision. */
export const REJECTED_XP = 0;

// ---------------------------------------------------------------------------
// Ranks
// ---------------------------------------------------------------------------

/**
 * Rank thresholds, ascending, first entry at 0.
 *
 * Gaps widen (250 / 500 / 1250 / 3000) so early progress is visible within a
 * session or two while the top rank stays a genuine commitment. `rankFor()`
 * depends on this being sorted ascending with a 0 floor; `xp.test.ts` asserts
 * both rather than trusting the literal to stay well-formed under editing.
 */
export const RANKS = [
  { name: "Rookie", min: 0 },
  { name: "Scout", min: 250 },
  { name: "Hunter", min: 750 },
  { name: "Breaker", min: 2000 },
  { name: "Legend", min: 5000 },
] as const;

export type RankName = (typeof RANKS)[number]["name"];

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Report submission limit, PER PLAYER, NEVER PER IP.
 *
 * A school NATs its whole network to one egress address, so an IP limit tight
 * enough to matter would take out a computing lab mid-playtest. The same note is
 * written into `reviews/config.ts` and `achievements/config.ts`; it is the single
 * most repeated footgun in this codebase.
 *
 * Generous compared with reviews (5 per 10 min) because a productive test
 * session legitimately produces a burst: a tester who finds a broken game files
 * several reports in a row and must not be silently throttled mid-flow.
 */
export const REPORT_RATE_LIMIT = {
  maxPerWindow: 10,
  windowSeconds: 600,
} as const;

/** Image submission limit, per player. Also never per IP — see above. */
export const SHOT_RATE_LIMIT = {
  maxPerWindow: 20,
  windowSeconds: 3600,
} as const;

/** Bounds on report text, enforced in the DB by CHECK and in the UI by maxLength. */
export const REPORT_TITLE_MIN = 1;
export const REPORT_TITLE_MAX = 120;
export const REPORT_BODY_MIN = 10;
export const REPORT_BODY_MAX = 2000;

/** Optional per-assignment note from the admin who issued it. */
export const ASSIGNMENT_BRIEF_MAX = 500;

/**
 * How many cover candidates one session keeps in memory before the tester picks.
 *
 * Bounded because candidates are held as decoded bitmaps in a long-lived tab; an
 * unbounded filmstrip on a 40-minute playtest is a memory leak with a UI.
 */
export const MAX_COVER_CANDIDATES = 6;

// ---------------------------------------------------------------------------
// Narrow-from-unknown helpers
// ---------------------------------------------------------------------------
//
// Every one of these takes `unknown` because the values arrive from FormData,
// JSON bodies and database columns — all three of which are `unknown` at the
// boundary. Casting instead would let a malformed value reach a CHECK constraint
// and turn a user mistake into a raw 500.

function memberOf<T extends readonly string[]>(
  list: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export function toReportKind(value: unknown): ReportKind | null {
  return memberOf(REPORT_KINDS, value) ? value : null;
}

export function toBugSeverity(value: unknown): BugSeverity | null {
  return memberOf(BUG_SEVERITIES, value) ? value : null;
}

export function toReportStatus(value: unknown): ReportStatus | null {
  return memberOf(REPORT_STATUSES, value) ? value : null;
}

export function toAssignmentStatus(value: unknown): AssignmentStatus | null {
  return memberOf(ASSIGNMENT_STATUSES, value) ? value : null;
}

export function toShotKind(value: unknown): ShotKind | null {
  return memberOf(SHOT_KINDS, value) ? value : null;
}

export function toShotStatus(value: unknown): ShotStatus | null {
  return memberOf(SHOT_STATUSES, value) ? value : null;
}
