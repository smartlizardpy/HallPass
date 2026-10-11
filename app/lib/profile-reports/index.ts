/**
 * HallPass — the profile-reports barrel: the live store bound to the shared Neon
 * client. `server-only`, like `invites/index.ts`; the factory in `store.ts`
 * stays testable against a fake `sql`.
 *
 * Writes throw so the route can tell "refused" from "down". The schema is
 * applied by hand, so a missing table is an expected, quiet failure window.
 */

import "server-only";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import { createProfileReportStore } from "./store";

export const profileReports = createProfileReportStore(sql);

export type { CreateReportOutcome, QueuedProfileReport } from "./store";

/** Log unless the failure is the expected missing-schema window. */
export function reportUnexpected(what: string, error: unknown): void {
  if (!isMissingColumnError(error) && !isUnconfiguredDbError(error)) {
    console.error(`[profile-reports] ${what} failed:`, error);
  }
}
