/**
 * HallPass Scoreboard — server barrel.
 *
 * The single import surface the route handlers use. It wires the live Neon
 * `sql` (from `db.ts`, which carries the `server-only` marker) into the store
 * factory and re-exports the pure validation/config helpers, so a route can
 * pull `store`, `verifyAdminSecret`, `clampLimit`, etc. from one place.
 *
 * Importing this module transitively imports `db.ts`, so it inherits the
 * `server-only` guarantee — it must never be pulled into a client bundle.
 */

import { sql, isScoreboardConfigured } from "./db";
import { createStore } from "./store";

/** The wired, production store backed by the live Neon connection. */
export const store = createStore(sql);

export { isScoreboardConfigured };
export * from "./config";
export * from "./guard";
export * from "./claim";
export type {
  AppendScoreInput,
  AppendScoreResult,
  ScoreboardStore,
  TopScoresOptions,
} from "./store";
