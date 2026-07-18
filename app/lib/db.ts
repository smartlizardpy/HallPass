/**
 * HallPass — the one and only live Neon connection, shared app-wide.
 *
 * Originally lived in `app/lib/scoreboard/db.ts`; promoted here because more than
 * the scoreboard now needs Neon (dashboard users/roles, future features). The
 * scoreboard barrel re-exports from this module for backwards compatibility.
 *
 * `import "server-only"` makes it a build error to pull this (and therefore the
 * raw connection string) into a client bundle.
 *
 * Why the query function is created once at module scope: the `neon()` HTTP
 * driver does not open a socket — each tagged-template call is a stateless
 * `fetch` to Neon's SQL-over-HTTP endpoint. So a module-level singleton is the
 * correct reuse pattern on Vercel Fluid Compute; there is no pool to manage.
 *
 * Graceful-when-unconfigured: `neon()` THROWS synchronously both when handed an
 * empty connection string AND when handed a present-but-malformed one (e.g. a
 * placeholder value pulled by `vercel build` running OFF Vercel, where Sensitive
 * system env vars are not materialized — see the "System environment variables
 * will not be available" warning). Either would crash module evaluation (and
 * every route that imports it), which fails the whole build during Next's
 * page-data collection. To honour "throw only when actually used", we catch that
 * synchronous failure and substitute a stand-in query function that throws a
 * clear error the moment a query is attempted, and expose {@link isDbConfigured}
 * so callers can answer 503 deliberately. At runtime on real Vercel infra the
 * correct `DATABASE_URL` is injected per cold start, so this only affects builds
 * and genuinely-unconfigured deployments — never a properly wired production one.
 */

import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL;

/**
 * Whether the shared {@link sql} is a live Neon client (as opposed to the
 * throw-on-use stand-in). True only when `DATABASE_URL` was present AND a valid
 * connection string that `neon()` accepted — a present-but-malformed value reads
 * as unconfigured, not configured-but-broken.
 */
let dbConfigured = false;

/** True when `DATABASE_URL` is present and valid, i.e. the database is reachable. */
export function isDbConfigured(): boolean {
  return dbConfigured;
}

/**
 * Stand-in used when `DATABASE_URL` is absent. It is a function (so a
 * tagged-template call invokes it) that throws a descriptive error — deferring
 * the failure from import time to first use. The cast is sound because callers
 * only ever invoke `sql` as a tagged template, never `.query`/`.unsafe`.
 */
const unconfiguredSql = ((): never => {
  throw new Error(
    "HallPass database is unconfigured: set DATABASE_URL to enable Neon-backed storage.",
  );
}) as unknown as NeonQueryFunction<false, false>;

/**
 * Build the shared query function, failing soft to {@link unconfiguredSql} when
 * `DATABASE_URL` is absent OR present-but-invalid. `neon()` validates the URL
 * synchronously and throws on a malformed one; catching it here defers that
 * failure from import time (which would crash the build) to first query.
 */
function createSql(): NeonQueryFunction<false, false> {
  if (!connectionString) return unconfiguredSql;
  try {
    const client = neon(connectionString);
    dbConfigured = true;
    return client;
  } catch (error) {
    console.error(
      "Invalid DATABASE_URL; deferring database failure to query time:",
      error,
    );
    return unconfiguredSql;
  }
}

/**
 * The shared Neon query function. Use it as a tagged template only:
 * `await sql\`SELECT ... WHERE id = ${id}\`` — interpolated values are sent as
 * bound parameters, never spliced into the SQL text.
 */
export const sql: NeonQueryFunction<false, false> = createSql();

/**
 * True when `error` is the "DATABASE_URL not set" failure thrown by the
 * unconfigured stand-in above. Lets a page render a friendly "set DATABASE_URL"
 * notice for that specific case while letting REAL database outages surface as
 * errors instead of being mislabelled as "not configured".
 */
export function isUnconfiguredDbError(error: unknown): boolean {
  return (
    error instanceof Error && /unconfigured|DATABASE_URL/i.test(error.message)
  );
}
