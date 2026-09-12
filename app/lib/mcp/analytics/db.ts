import "server-only";

/**
 * HallPass — the read-only Neon connection the analytics MCP queries through.
 *
 * A SECOND client, deliberately not the shared `sql` from `app/lib/db.ts`, and
 * the separation is the whole point rather than a convenience:
 *
 *   * It connects as a DIFFERENT POSTGRES ROLE (`mcp_reader`), which holds no
 *     privileges on the `public` schema at all and `SELECT` on the `mcp` views
 *     only. That role is what makes migration `031`'s PII-stripped views a
 *     boundary instead of a suggestion — see
 *     `scripts/provision-mcp-reader.mjs`, which proves it rather than claiming
 *     it.
 *   * It is opened `readOnly`, so every statement runs inside a `READ ONLY`
 *     Postgres transaction. That is belt to the role's braces: two independent
 *     things have to fail before a write is possible.
 *
 * ── IT NEVER FALLS BACK TO `DATABASE_URL` ─────────────────────────────────
 * If `MCP_ANALYTICS_DATABASE_URL` is unset this module reports itself
 * unavailable and the tool is not registered (`analytics/tools.ts`). Borrowing
 * the app's own connection would work perfectly and would hand a language model
 * every child's email address, which is the exact failure the view layer exists
 * to prevent. A missing credential must disable a feature, never widen it.
 *
 * ── `sql.query()` IS THE ONE SANCTIONED EXCEPTION TO THE TAGGED-TEMPLATE RULE
 * `app/lib/db.ts` says, in bold, to use `sql` as a tagged template only, so
 * interpolated values are always bound parameters. That rule is right, and this
 * module breaks it: the caller here supplies a whole query, not a value, so
 * there is nothing to parameterise. What replaces the rule is the pair above —
 * a role that cannot write or read anything private, and a read-only
 * transaction — plus `sql-guard.ts` for shape and cost. Nothing about the query
 * text is trusted; it simply cannot do damage.
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let client: NeonQueryFunction<false, false> | null = null;
let attempted = false;

/**
 * The reader, or `null` when it is not provisioned.
 *
 * Built lazily and cached, and the environment is read on FIRST USE rather than
 * at import — a value set after import, by Vercel or by a test, has to be seen.
 * `neon()` throws synchronously on a malformed connection string, so that is
 * caught and read as "not provisioned" rather than being allowed to take down
 * module evaluation, exactly as `app/lib/db.ts` argues.
 */
function reader(): NeonQueryFunction<false, false> | null {
  if (attempted) return client;
  attempted = true;
  const connectionString = process.env.MCP_ANALYTICS_DATABASE_URL?.trim();
  if (!connectionString) return null;
  try {
    client = neon(connectionString, { readOnly: true });
  } catch (error) {
    console.error("Invalid MCP_ANALYTICS_DATABASE_URL; the SQL tool stays off:", error);
    client = null;
  }
  return client;
}

/** Whether `run_analytics_sql` can be offered at all. */
export function isAnalyticsDbConfigured(): boolean {
  return reader() !== null;
}

/** What a guarded query returned. */
export type AnalyticsRows = {
  rows: Record<string, unknown>[];
  /** True when the row cap was reached, so a reader knows the answer is partial. */
  truncated: boolean;
};

/**
 * Run one already-guarded, already-bounded query.
 *
 * The text arrives from {@link guardAnalyticsSql}, which has wrapped it in a
 * `LIMIT`. `rows.length === limit` therefore means "possibly more", and saying
 * so matters: an agent that reads a truncated list as complete will report a
 * total that is exactly the cap and be confident about it.
 *
 * Errors are RE-THROWN, not swallowed. The tool layer turns a Postgres message
 * into the tool's answer, because "column x does not exist" is precisely what a
 * model needs in order to write the next query correctly — degrading to an
 * empty result would have it conclude there is no data.
 */
export async function runAnalyticsQuery(
  sql: string,
  limit: number,
): Promise<AnalyticsRows> {
  const query = reader();
  if (!query) {
    throw new Error(
      "The analytics database reader is not configured. Set MCP_ANALYTICS_DATABASE_URL " +
        "(see scripts/provision-mcp-reader.mjs).",
    );
  }
  const rows = (await query.query(sql)) as Record<string, unknown>[];
  return { rows, truncated: rows.length >= limit };
}

/**
 * The `mcp` schema as a model needs to see it: every view and its columns.
 *
 * Read from `information_schema` rather than kept as a checked-in list, because
 * a list would drift from the migration the first time a view gained a column
 * and nobody would notice until a query failed. The reader role can see
 * `information_schema` for its own objects, which is why `search_path` keeps
 * `pg_catalog` on it.
 */
export async function describeAnalyticsViews(): Promise<
  { view: string; columns: { name: string; type: string }[] }[]
> {
  const query = reader();
  if (!query) return [];
  const rows = (await query.query(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'mcp'
      ORDER BY table_name, ordinal_position`,
  )) as { table_name: string; column_name: string; data_type: string }[];

  const byView = new Map<string, { name: string; type: string }[]>();
  for (const row of rows) {
    const columns = byView.get(row.table_name) ?? [];
    columns.push({ name: row.column_name, type: row.data_type });
    byView.set(row.table_name, columns);
  }
  return [...byView].map(([view, columns]) => ({ view, columns }));
}
