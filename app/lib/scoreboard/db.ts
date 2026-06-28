/**
 * HallPass Scoreboard — Neon connection (compat shim).
 *
 * The live Neon singleton now lives in the shared `app/lib/db.ts` so non-
 * scoreboard features (dashboard users/roles) can reuse the same connection.
 * This module re-exports it under the scoreboard's historical names so the
 * store/barrel and existing imports keep working unchanged.
 */

import { sql, isDbConfigured } from "@/app/lib/db";

export { sql };

/** True when `DATABASE_URL` is present, i.e. the scoreboard can reach Neon. */
export const isScoreboardConfigured = isDbConfigured;
