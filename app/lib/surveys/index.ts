/**
 * HallPass — the surveys barrel: the live store bound to the shared Neon client.
 *
 * Mirrors `tracker/index.ts`. The factory in `store.ts` stays free of
 * `server-only` so it can be unit-tested against a fake tagged template; THIS
 * module reaches for the real connection and must never reach a client bundle.
 *
 * WHY THE FAIL-SOFT READ WRAPPERS EXIST. Schema is applied by hand (see
 * `scoreboard/migrations/`), so there is always a window where this code runs
 * against a database with no `surveys` table. The PLAYER-facing reads degrade to
 * "no survey" so the site banner and `/survey/[slug]` quietly show nothing
 * instead of a 500 on every page.
 *
 * THE ADMIN READS ARE NOT WRAPPED. A dashboard list that swallowed a missing
 * table would render a convincingly empty survey list, and an MCP client handed
 * `[]` would create a duplicate of everything already there (the argument
 * `mcp/tracker.ts` makes for its board). Those pages and tools use `surveys`
 * directly and let the error surface; {@link isSurveysReady} lets a page say "run
 * migration 037" instead.
 *
 * Unexpected failures in the wrapped reads are logged before degrading, so a real
 * Neon outage is not indistinguishable from "no survey is running".
 */

import "server-only";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import { createSurveyStore } from "./store";

/** The live store. Use it directly where errors should surface (admin, writes). */
export const surveys = createSurveyStore(sql);

export type {
  PublicSurvey,
  QuestionResult,
  SubmitOutcome,
  SurveyDetail,
  SurveyQuestion,
  SurveyResults,
  SurveySummary,
} from "./store";

function isExpectedMissingSchema(error: unknown): boolean {
  return isMissingColumnError(error) || isUnconfiguredDbError(error);
}

function reportUnexpected(what: string, error: unknown): void {
  if (!isExpectedMissingSchema(error)) {
    console.error(`[surveys] ${what} failed:`, error);
  }
}

/** A live survey for the player page, or `null` (also when the schema is missing). */
export async function getPublicSurvey(slug: string, playerId: string | null) {
  try {
    return await surveys.getPublicSurvey(slug, playerId);
  } catch (error) {
    reportUnexpected("getPublicSurvey", error);
    return null;
  }
}

/** The survey the site banner should advertise, or `null`. */
export async function getBannerSurvey(playerId: string | null) {
  try {
    return await surveys.getBannerSurvey(playerId);
  } catch (error) {
    reportUnexpected("getBannerSurvey", error);
    return null;
  }
}

/**
 * Whether the survey schema is reachable, so an admin page can say "run
 * migration 037" instead of rendering an empty list. A real outage throws.
 */
export async function isSurveysReady(): Promise<boolean> {
  try {
    await sql`SELECT 1 FROM surveys LIMIT 1`;
    return true;
  } catch (error) {
    if (isExpectedMissingSchema(error)) return false;
    throw error;
  }
}
