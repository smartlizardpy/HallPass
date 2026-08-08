/**
 * HallPass — the tracker barrel: the live store bound to the shared Neon client.
 *
 * Mirrors `reviews/index.ts`, `beta/index.ts` and `social/index.ts`. The factory
 * in `store.ts` stays free of `server-only` so it can be unit-tested against a
 * fake tagged template; THIS module reaches for the real connection, so it is
 * the one that must never reach a client bundle.
 *
 * WHY THE FAIL-SOFT READ WRAPPERS EXIST. Schema here is applied BY HAND (see
 * `scoreboard/migrations/`, and `HANDOFF.md` for a live case where a migration
 * never reached production), so there is always a window where this code runs
 * against a database with no `tracker_*` tables. Reads degrade to empty exactly
 * as `beta/index.ts` does.
 *
 * They swallow the RESULT but not the SIGNAL: a missing table or an unconfigured
 * `DATABASE_URL` is expected during that window and stays quiet, while anything
 * else is logged before degrading. A genuine Neon outage that vanished without a
 * log line would be indistinguishable from "nobody has pasted anything in yet",
 * which is the most misleading thing this surface could report.
 *
 * WRITES ARE NOT WRAPPED. A server action has to tell "refused" from "the
 * database is down" to choose between a banner and a 500, so writes throw and
 * the action decides — the same split `beta/index.ts` documents.
 */

import "server-only";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import { createTrackerStore } from "./store";

/** The live store. Use it directly where you want errors to surface (writes). */
export const tracker = createTrackerStore(sql);

export type {
  TrackerCard,
  TrackerEvent,
  TrackerItem,
  TrackerUpdate,
} from "./store";

/**
 * True when `error` is the expected "schema is not here yet" pair — no tables,
 * or no `DATABASE_URL` at all. Anything else is a real fault.
 */
function isExpectedMissingSchema(error: unknown): boolean {
  return isMissingColumnError(error) || isUnconfiguredDbError(error);
}

/** Log unless the failure is the expected missing-schema window. */
function reportUnexpected(what: string, error: unknown): void {
  if (!isExpectedMissingSchema(error)) {
    console.error(`[tracker] ${what} failed:`, error);
  }
}

/** Every live item for the board, or `[]` if the tracker schema is not there. */
export async function getBoard() {
  try {
    return await tracker.listBoard();
  } catch (error) {
    reportUnexpected("listBoard", error);
    return [];
  }
}

/** One item in full, or `null` when missing — including when the schema is. */
export async function getItem(id: number) {
  try {
    return await tracker.getItem(id);
  } catch (error) {
    reportUnexpected("getItem", error);
    return null;
  }
}

/** An item's progress notes, or `[]`. */
export async function getUpdates(itemId: number) {
  try {
    return await tracker.listUpdates(itemId);
  } catch (error) {
    reportUnexpected("listUpdates", error);
    return [];
  }
}

/** An item's activity trail, or `[]`. */
export async function getEvents(itemId: number) {
  try {
    return await tracker.listEvents(itemId);
  } catch (error) {
    reportUnexpected("listEvents", error);
    return [];
  }
}

/** Every tag in use, for the filter bar, or `[]`. */
export async function getTags() {
  try {
    return await tracker.listTags();
  } catch (error) {
    reportUnexpected("listTags", error);
    return [];
  }
}

/** The archive bin, or `[]`. */
export async function getArchived() {
  try {
    return await tracker.listArchived();
  } catch (error) {
    reportUnexpected("listArchived", error);
    return [];
  }
}

/**
 * Whether the tracker schema is reachable, so a page can say "run migration
 * 021" instead of rendering a convincingly empty board.
 *
 * Deliberately a probe rather than a flag threaded out of every read: the reads
 * above already degrade to `[]`, and an empty board and an absent table are
 * indistinguishable from their return values alone. That ambiguity is the whole
 * reason this exists.
 */
export async function isTrackerReady(): Promise<boolean> {
  try {
    await sql`SELECT 1 FROM tracker_items LIMIT 1`;
    return true;
  } catch (error) {
    if (isExpectedMissingSchema(error)) return false;
    // A real outage is NOT "not ready" — let the page's own error handling deal
    // with it rather than mislabelling Neon being down as a missing migration.
    throw error;
  }
}
