/**
 * HallPass — what `run_analytics_sql` will and will not send to Postgres.
 *
 * PURE and free of `server-only`, like every other rule in this feature, so the
 * refusals below are unit-tested rather than discovered in production.
 *
 * ── THIS IS NOT THE SECURITY BOUNDARY, AND SAYING SO MATTERS ───────────────
 * The boundary is the Postgres role (`scripts/provision-mcp-reader.mjs`): it
 * holds no privileges on `public` and no write privileges anywhere, so a
 * `DELETE` or a `SELECT email FROM public.players` is refused by the database
 * whatever this file does. If this module were deleted the data would still be
 * safe; it would just be easy to hang the endpoint.
 *
 * So this file is about SHAPE and COST, not authority:
 *
 *   * ONE statement. A caller that can send two can send a `SELECT` followed by
 *     anything, and even though the role would refuse the second, the refusal
 *     would arrive as a confusing half-failure.
 *   * It must READ. A statement that does not begin `SELECT` or `WITH` is
 *     refused here with a sentence, rather than by Postgres with a permission
 *     error that reads like a bug in this feature.
 *   * It must be BOUNDED. The caller is a language model paying for every row
 *     in its context, and the failure is silent: a query that returns forty
 *     thousand rows does not error, it just makes the rest of the conversation
 *     worse. Same argument as `mcp/config.ts`'s report ceiling.
 *
 * ── WHY THE ROW CAP IS A WRAPPER AND NOT AN APPENDED `LIMIT` ───────────────
 * Appending ` LIMIT 500` to a query that already ends in `LIMIT 1` is a syntax
 * error, and detecting an existing `LIMIT` by regex means parsing SQL badly.
 * Wrapping instead — `SELECT * FROM (<query>) AS mcp_result LIMIT n` — composes
 * with anything that is a valid subquery, which is exactly the set of things
 * that are valid here. Verified against the live database for plain selects,
 * `ORDER BY`, an existing `LIMIT`, CTEs, joins, duplicate output column names
 * and leading comments. The one shape it does NOT survive is a trailing
 * semicolon, which is why {@link guardAnalyticsSql} strips one.
 */

/** Rows one query may return before it is truncated. */
export const MAX_ROWS = 500;

/** The default when the caller does not ask for a specific cap. */
export const DEFAULT_ROWS = 200;

/** The longest query text accepted, in characters. */
export const MAX_SQL_LENGTH = 8000;

/** The alias the wrapper uses. Named so it is recognisable in an error. */
export const RESULT_ALIAS = "mcp_result";

export type GuardResult =
  | { ok: true; sql: string; limit: number }
  | { ok: false; reason: string };

/**
 * Strip comments and string literals, leaving structure.
 *
 * Written as a scanner rather than a regex because every interesting case is
 * one where a `;` or a keyword is INSIDE something: `WHERE name = 'a;b'`,
 * `-- drop everything`, a dollar-quoted body. A regex that ignores those
 * refuses valid queries, and a reader cannot tell which ones without running it.
 *
 * Quoted spans are replaced by a single space rather than removed, so token
 * boundaries survive: `a'x'b` must not become `ab`.
 */
export function stripSqlNoise(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      // Postgres block comments nest, so a naive scan to the first `*/` would
      // leave the tail of an outer comment looking like code.
      let depth = 1;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; continue; }
        i++;
      }
      out += " ";
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === quote && sql[i + 1] === quote) { i += 2; continue; }
        if (sql[i] === quote) { i++; break; }
        i++;
      }
      out += " ";
      continue;
    }
    if (ch === "$") {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (tag) {
        const marker = tag[0];
        const end = sql.indexOf(marker, i + marker.length);
        i = end === -1 ? sql.length : end + marker.length;
        out += " ";
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Validate a model-written query and return the bounded form to execute.
 *
 * `limit` is clamped rather than refused, for the reason `clampLimit` in
 * `mcp/config.ts` gives: the tool's job is to answer the question, and failing
 * a whole call over an out-of-range number is a worse answer than returning the
 * nearest sensible page.
 */
export function guardAnalyticsSql(raw: unknown, limit?: number): GuardResult {
  if (typeof raw !== "string") {
    return { ok: false, reason: "The query must be a string." };
  }

  // A trailing semicolon is idiomatic and harmless, and it is the one shape the
  // wrapper cannot survive — so it is normalised away rather than refused.
  const sql = raw.trim().replace(/;\s*$/, "").trim();

  if (!sql) return { ok: false, reason: "The query is empty." };
  if (sql.length > MAX_SQL_LENGTH) {
    return {
      ok: false,
      reason: `The query is ${sql.length} characters; the limit is ${MAX_SQL_LENGTH}.`,
    };
  }

  const bare = stripSqlNoise(sql);

  if (bare.includes(";")) {
    return {
      ok: false,
      reason:
        "Send one statement at a time. Everything after the first semicolon was refused.",
    };
  }

  const firstWord = /^\s*([a-z]+)/i.exec(bare)?.[1]?.toUpperCase() ?? "";
  if (firstWord !== "SELECT" && firstWord !== "WITH") {
    return {
      ok: false,
      reason:
        `This tool runs read-only queries: start with SELECT or WITH (got ${firstWord || "nothing"}). ` +
        "The connection has no write privileges either, so a write would be refused by Postgres as well.",
    };
  }

  const clamped = clampRows(limit);
  return {
    ok: true,
    limit: clamped,
    sql: `SELECT * FROM (\n${sql}\n) AS ${RESULT_ALIAS} LIMIT ${clamped}`,
  };
}

/** Clamp a caller-supplied row cap into the allowed band. */
export function clampRows(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return DEFAULT_ROWS;
  const whole = Math.floor(limit);
  if (whole < 1) return 1;
  if (whole > MAX_ROWS) return MAX_ROWS;
  return whole;
}

/**
 * The same shape check for a HogQL query against PostHog.
 *
 * HogQL is ClickHouse-flavoured SQL and PostHog's `HogQLQuery` kind only ever
 * runs a read — so, as with the Postgres side, this is about SHAPE and COST
 * rather than authority. The difference is where the authority comes from:
 * there is no second Postgres role here, only a personal API key that PostHog
 * scopes to `query:read`. That is a weaker guarantee than a role with no write
 * grants, which is why the leading-keyword check is the same and the ceiling is
 * lower — a PostHog event table is very much larger than any table here.
 *
 * The wrapper is identical because ClickHouse accepts the same subquery form.
 */
export function guardHogqlQuery(raw: unknown, limit?: number): GuardResult {
  const result = guardAnalyticsSql(raw, limit);
  if (!result.ok) return result;
  // `guardAnalyticsSql` has already stripped the trailing semicolon, refused a
  // second statement and pinned the leading keyword; only the alias differs, and
  // it does not, so the accepted form is reused verbatim.
  return result;
}
