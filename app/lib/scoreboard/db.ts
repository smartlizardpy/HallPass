/**
 * HallPass Scoreboard — the one and only live Neon connection.
 *
 * `import "server-only"` makes it a build error to pull this (and therefore the
 * raw connection string) into a client bundle.
 *
 * Why the query function is created once at module scope: the `neon()` HTTP
 * driver does not open a socket — each tagged-template call is a stateless
 * `fetch` to Neon's SQL-over-HTTP endpoint. So a module-level singleton is the
 * correct reuse pattern on Vercel Fluid Compute; there is no pool to manage.
 *
 * Graceful-when-unconfigured: `neon()` THROWS synchronously if handed an empty
 * connection string, which would crash module evaluation (and every route that
 * imports the barrel) on a deployment that simply hasn't wired `DATABASE_URL`
 * yet. To honour "throw only when actually used", we substitute a stand-in
 * query function that throws a clear error the moment a query is attempted, and
 * expose {@link isScoreboardConfigured} so callers can answer 503 deliberately.
 */

import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL;

/** True when `DATABASE_URL` is present, i.e. the scoreboard can reach Neon. */
export function isScoreboardConfigured(): boolean {
  return Boolean(connectionString);
}

/**
 * Stand-in used when `DATABASE_URL` is absent. It is a function (so a
 * tagged-template call invokes it) that throws a descriptive error — deferring
 * the failure from import time to first use. The cast is sound because the
 * store only ever calls `sql` as a tagged template, never `.query`/`.unsafe`.
 */
const unconfiguredSql = ((): never => {
  throw new Error(
    "HallPass scoreboard is unconfigured: set DATABASE_URL to enable leaderboard storage.",
  );
}) as unknown as NeonQueryFunction<false, false>;

/**
 * The shared Neon query function. Use it as a tagged template only:
 * `await sql\`SELECT ... WHERE slug = ${slug}\`` — interpolated values are sent
 * as bound parameters, never spliced into the SQL text.
 */
export const sql: NeonQueryFunction<false, false> = connectionString
  ? neon(connectionString)
  : unconfiguredSql;
