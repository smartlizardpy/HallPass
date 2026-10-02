/**
 * HallPass — the server-side streak barrel: the live store bound to the shared
 * Neon client.
 *
 * Mirrors `notifications/index.ts`. The factory stays free of `server-only` so
 * it can be tested against a fake tagged template; THIS module reaches for the
 * real connection and must never reach a client bundle.
 *
 * WRITES ARE NOT WRAPPED. The beacon route and the reminder route each have to
 * tell "the schema is not here yet" from a real fault to choose what to answer,
 * so the store throws and they decide. {@link isMissingStreakSchema} is the one
 * place that question is answered.
 */

import "server-only";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import { createStreakStore } from "./server-store";

/** The live store. */
export const streaks = createStreakStore(sql);

export type { RecordedDay, DuePlayer } from "./server-store";

/**
 * True for the expected "migration 036 has not been applied" pair — no table, or
 * no `DATABASE_URL` at all. Anything else is a real fault worth logging.
 */
export function isMissingStreakSchema(error: unknown): boolean {
  return isMissingColumnError(error) || isUnconfiguredDbError(error);
}
