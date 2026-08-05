/**
 * HallPass — the beta programme barrel: the live store bound to the shared Neon
 * client, the membership guard, and the fail-soft reads pages use.
 *
 * Mirrors `achievements/index.ts`, `reviews/index.ts` and `social/index.ts`. The
 * factory in `store.ts` stays free of `server-only` so it can be unit-tested
 * against a fake tagged template; THIS module reaches for the real connection,
 * so it is the one that must never reach a client bundle.
 *
 * WHY THE FAIL-SOFT WRAPPERS EXIST. Schema here is applied BY HAND (see
 * `scoreboard/migrations/`), so there is always a window where this code is live
 * against a database with no `beta_*` tables yet. Reads degrade to empty exactly
 * as `getGameMedia()` does. They swallow the RESULT but not the SIGNAL: a
 * missing table or an unconfigured `DATABASE_URL` is expected during that window
 * and stays quiet, while anything else is logged before degrading — a genuine
 * Neon outage that vanished without a log line would be indistinguishable from
 * "the programme has no members".
 *
 * WRITES ARE NOT WRAPPED. A server action needs to distinguish "refused" from
 * "the database is down" to pick between a banner and a 500, so writes throw and
 * the action decides.
 */

import "server-only";
import { redirect } from "next/navigation";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import { auth } from "@/app/lib/auth";
import { createBetaStore } from "./store";
import type {
  BetaAssignment,
  BetaReport,
  BetaReportWithAuthor,
  BetaShot,
  RosterEntry,
  XpAward,
} from "./store";
import { rankFor, type RankProgress } from "./xp";

/** The live store. Use it directly where you want errors to surface. */
export const beta = createBetaStore(sql);

export type {
  BetaAssignment,
  BetaReport,
  BetaReportWithAuthor,
  BetaShot,
  BetaStore,
  BetaTester,
  RosterEntry,
  XpAward,
} from "./store";

/**
 * True when `error` is the expected "this deployment is ahead of its schema"
 * shape, i.e. safe to degrade silently. Anything else is a real fault.
 */
function isExpectedSchemaGap(error: unknown): boolean {
  return isMissingColumnError(error) || isUnconfiguredDbError(error);
}

function degrade<T>(where: string, error: unknown, fallback: T): T {
  if (!isExpectedSchemaGap(error)) {
    console.error(`beta.${where} failed; degrading:`, error);
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/** What `requireBetaTester()` hands back once it has let a request through. */
export type BetaSession = {
  playerId: string;
  /** True when access came from an admin role rather than a membership row. */
  viaAdmin: boolean;
};

/**
 * Gate a beta surface on programme membership.
 *
 * The PLAYER-side counterpart to `requireRole()` in `app/lib/auth.ts`, and
 * deliberately a separate function rather than a new rung on that ladder:
 * `Role` is dashboard authorization with a two-value CHECK behind it, and a
 * min-role ladder cannot express "may file reports but may not open moderation".
 *
 * Three outcomes, each with its own destination, because collapsing them tells
 * users something untrue:
 *   * Not signed in → sign-in, returning here afterwards.
 *   * Signed in, never invited (or revoked) → `/beta/closed`, which explains the
 *     programme rather than 404ing at someone who followed a real link.
 *   * Signed in and active → returns.
 *
 * ADMINS PASS WITHOUT A MEMBERSHIP ROW. They already administer the queue; making
 * them invite themselves to look at the tester's own view would be friction with
 * no security value.
 *
 * FAILS CLOSED. A database error means membership cannot be confirmed, so the
 * request is treated as "not a tester" rather than waved through — the one place
 * in this module that must not degrade generously.
 */
export async function requireBetaTester(
  callbackPath = "/beta",
): Promise<BetaSession> {
  const session = await auth();
  const playerId = session?.user?.playerId;
  if (!playerId) {
    redirect(`/play/signin?callbackUrl=${encodeURIComponent(callbackPath)}`);
  }
  if (session?.user?.role) return { playerId, viaAdmin: true };

  let active = false;
  try {
    active = await beta.isActiveTester(playerId);
  } catch (error) {
    // Deliberately no `degrade()` here: this is the guard, and a quiet `false`
    // is the SAFE degradation. Still logged, because a guard failing closed for
    // every tester at once is an outage worth seeing.
    console.error("beta.requireBetaTester membership check failed:", error);
    active = false;
  }
  if (!active) redirect("/beta/closed");
  return { playerId, viaAdmin: false };
}

/**
 * Membership state for a UI that wants to show a link WITHOUT gating a page —
 * the account menu and the mobile tab bar. Fail-soft to `false`: a missing entry
 * point is a smaller harm than a crashed menu on every page of the site.
 */
export async function isBetaTester(playerId: string): Promise<boolean> {
  try {
    return await beta.isActiveTester(playerId);
  } catch (error) {
    return degrade("isActiveTester", error, false);
  }
}

// ---------------------------------------------------------------------------
// Fail-soft reads
// ---------------------------------------------------------------------------

/** One tester's XP total. Fail-soft to `0` — never wrongly GRANTS anything. */
export async function getBetaXp(playerId: string): Promise<number> {
  try {
    return await beta.xpFor(playerId);
  } catch (error) {
    return degrade("xpFor", error, 0);
  }
}

/** XP plus the derived rank, which every beta surface renders together. */
export async function getBetaStanding(
  playerId: string,
): Promise<{ xp: number; rank: RankProgress }> {
  const xp = await getBetaXp(playerId);
  return { xp, rank: rankFor(xp) };
}

/** One tester's assignment queue. Fail-soft to `[]`. */
export async function getAssignments(
  playerId: string,
): Promise<BetaAssignment[]> {
  try {
    return await beta.assignmentsFor(playerId);
  } catch (error) {
    return degrade("assignmentsFor", error, []);
  }
}

/** One tester's own reports. Fail-soft to `[]`. */
export async function getOwnReports(playerId: string): Promise<BetaReport[]> {
  try {
    return await beta.reportsFor(playerId);
  } catch (error) {
    return degrade("reportsFor", error, []);
  }
}

/** One tester's own image submissions. Fail-soft to `[]`. */
export async function getOwnShots(playerId: string): Promise<BetaShot[]> {
  try {
    return await beta.shotsFor(playerId);
  } catch (error) {
    return degrade("shotsFor", error, []);
  }
}

/** One tester's XP ledger. Fail-soft to `[]`. */
export async function getOwnAwards(playerId: string): Promise<XpAward[]> {
  try {
    return await beta.awardsFor(playerId);
  } catch (error) {
    return degrade("awardsFor", error, []);
  }
}

/** The admin roster. Fail-soft to `[]`. */
export async function getRoster(): Promise<RosterEntry[]> {
  try {
    return await beta.roster();
  } catch (error) {
    return degrade("roster", error, []);
  }
}

/** The admin triage queue. Fail-soft to `[]`. */
export async function getReportQueue(): Promise<BetaReportWithAuthor[]> {
  try {
    return await beta.reportQueue();
  } catch (error) {
    return degrade("reportQueue", error, []);
  }
}

/** The admin image-review queue. Fail-soft to `[]`. */
export async function getShotQueue(): Promise<BetaShot[]> {
  try {
    return await beta.shotQueue();
  } catch (error) {
    return degrade("shotQueue", error, []);
  }
}

/** Every assignment, for the admin overview. Fail-soft to `[]`. */
export async function getAllAssignments(): Promise<BetaAssignment[]> {
  try {
    return await beta.allAssignments();
  } catch (error) {
    return degrade("allAssignments", error, []);
  }
}
