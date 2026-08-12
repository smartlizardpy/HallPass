/**
 * HallPass — the challenges barrel: the live store bound to the shared Neon client.
 *
 * Mirrors `tracker/index.ts`, `social/index.ts` and `beta/index.ts`. The factory
 * in `store.ts` stays free of `server-only` so it can be unit-tested against a
 * fake tagged template; THIS module reaches for the real connection, so it is
 * the one that must never reach a client bundle.
 *
 * WHY THE FAIL-SOFT READ WRAPPERS EXIST. Schema here is applied BY HAND (see
 * `scoreboard/migrations/`, and `HANDOFF.md` for a live case where a migration
 * never reached production), so there is always a window where this code runs
 * against a database with no `challenges` table. Reads degrade to empty.
 *
 * They swallow the RESULT but not the SIGNAL: a missing table or an
 * unconfigured `DATABASE_URL` is expected during that window and stays quiet,
 * while anything else is logged before degrading. A genuine Neon outage that
 * vanished without a log line would be indistinguishable from "nobody has
 * challenged you", which is the most misleading thing this surface could say.
 *
 * WRITES ARE NOT WRAPPED — with ONE deliberate exception. A route has to tell
 * "refused" from "the database is down" to choose between a message and a 500,
 * so `create`/`accept`/`dismiss` throw and the caller decides. The exception is
 * {@link resolveChallengesForScore}, documented at its definition: its caller is
 * the score-submission path, which must not fail for a reason the player did not
 * cause and cannot act on.
 */

import "server-only";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import { createChallengeStore } from "./store";

/** The live store. Use it directly where you want errors to surface (writes). */
export const challenges = createChallengeStore(sql);

export type {
  ChallengeParty,
  ClaimLinkOutcome,
  CreateOutcome,
  IncomingChallenge,
  LinkOwner,
  MintLinkOutcome,
  OutgoingChallenge,
  OwnedLink,
  PublicLink,
  ResolvedChallenge,
} from "./store";

/**
 * True when `error` is the expected "schema is not here yet" pair — no table, or
 * no `DATABASE_URL` at all. Anything else is a real fault.
 */
function isExpectedMissingSchema(error: unknown): boolean {
  return isMissingColumnError(error) || isUnconfiguredDbError(error);
}

/** Log unless the failure is the expected missing-schema window. */
function reportUnexpected(what: string, error: unknown): void {
  if (!isExpectedMissingSchema(error)) {
    console.error(`[challenges] ${what} failed:`, error);
  }
}

/** Open challenges aimed at this player, or `[]` if the schema is not there. */
export async function getIncoming(me: string) {
  try {
    return await challenges.listIncoming(me);
  } catch (error) {
    reportUnexpected("listIncoming", error);
    return [];
  }
}

/** Challenges this player sent, or `[]`. Dismissed ones are never included. */
export async function getOutgoing(me: string) {
  try {
    return await challenges.listOutgoing(me);
  } catch (error) {
    reportUnexpected("listOutgoing", error);
    return [];
  }
}

/** Open challenges aimed at this player on one game's boards, or `[]`. */
export async function getForGame(me: string, gameSlug: string) {
  try {
    return await challenges.listForGame(me, gameSlug);
  } catch (error) {
    reportUnexpected("listForGame", error);
    return [];
  }
}

/** How many open challenges are aimed at this player, or `0`. */
export async function getIncomingCount(me: string) {
  try {
    return await challenges.countIncoming(me);
  } catch (error) {
    reportUnexpected("countIncoming", error);
    return 0;
  }
}

/**
 * Close every challenge this score just won — THE ONE WRAPPED WRITE.
 *
 * Its caller is `POST /api/v1/leaderboard/<board>`, which has already recorded
 * the score by the time this runs. A challenge table that is missing, slow or
 * broken must not turn a successful score submission into an error: the player
 * did not cause it, cannot act on it, and losing their score to it would be a
 * far worse bug than a challenge that stays open a while longer.
 *
 * So this degrades to `[]` — no challenges resolved, no notifications sent, the
 * score kept — and logs anything that is not the expected missing-schema window.
 * The challenge is not lost, only unresolved: the next qualifying score closes it.
 */
export async function resolveChallengesForScore(input: {
  playerId: string;
  boardId: string;
  score: number;
}) {
  try {
    return await challenges.resolveForScore(input);
  } catch (error) {
    reportUnexpected("resolveForScore", error);
    return [];
  }
}

/**
 * One link by its code, or `null` when it does not exist OR cannot be read.
 *
 * COLLAPSING THOSE TWO IS SAFE HERE, unlike everywhere else in this module. The
 * caller is `/c/<code>`, whose only non-happy path is a page saying the
 * challenge is not available — which is the honest thing to show for a code
 * that was mistyped, for one that was never real, and for a database that is
 * briefly unreachable. The distinction the other reads preserve buys the
 * landing page nothing, because there is no partial render to protect: no link,
 * no page. The unexpected case is still logged.
 */
export async function getLink(code: string) {
  try {
    return await challenges.getLinkByCode(code);
  } catch (error) {
    reportUnexpected("getLinkByCode", error);
    return null;
  }
}

/** This player's share links with their counts, or `[]`. */
export async function getOwnedLinks(me: string) {
  try {
    return await challenges.listLinks(me);
  } catch (error) {
    reportUnexpected("listLinks", error);
    return [];
  }
}

/**
 * Count a press of "Beat it" from somebody signed out — THE SECOND WRAPPED WRITE.
 *
 * Wrapped for the same reason {@link resolveChallengesForScore} is, and with
 * even less to argue about: this is a statistic on somebody else's dashboard,
 * and the caller is standing between a child and the game they were promised.
 * A missing table, a slow query or a dead link must all end the same way — the
 * game opens. Losing a count is not a bug worth a single second of delay.
 */
export async function noteLinkOpen(code: string): Promise<void> {
  try {
    await challenges.noteLinkOpen(code);
  } catch (error) {
    reportUnexpected("noteLinkOpen", error);
  }
}

/**
 * Whether the challenges schema is reachable, so a surface can stay silent
 * rather than rendering a convincingly empty inbox.
 *
 * Deliberately a probe rather than a flag threaded out of every read: the reads
 * above already degrade to `[]`, and an empty inbox and an absent table are
 * indistinguishable from their return values alone. That ambiguity is the whole
 * reason this exists.
 */
export async function isChallengesReady(): Promise<boolean> {
  try {
    await sql`SELECT 1 FROM challenges LIMIT 1`;
    return true;
  } catch (error) {
    if (isExpectedMissingSchema(error)) return false;
    // A real outage is NOT "not ready" — let the caller's own error handling
    // deal with it rather than mislabelling Neon being down as a missing
    // migration.
    throw error;
  }
}
