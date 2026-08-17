/**
 * HallPass — reading a PostHog query response by column NAME.
 *
 * Pure, and deliberately free of `server-only` (same reasoning as
 * `growth/config.ts`): the mapping every analytics panel stands on can then be
 * unit-tested without a network call, an API key or a running project.
 *
 * WHY THIS EXISTS. PostHog's `/api/projects/:id/query/` answers a `HogQLQuery`
 * POSITIONALLY. `results` is an array of ARRAYS — one value per column, in
 * `SELECT` order — and the names live in a sibling `columns` array. A caller
 * that types the response as `{ devices: number }[]` type-checks, runs, returns
 * rows, and reads `undefined` out of every one of them. That does not look like
 * a failure downstream: `undefined ?? 0` renders as a confident `0`, and
 * `Intl.NumberFormat.format(undefined)` renders as `NaN`. It is exactly how the
 * growth page came to report zero devices, a column of NaNs and "PostHog holds
 * no events at all" while the project was receiving events normally.
 *
 * Zipping the two arrays here removes the whole class of mistake: a name that is
 * not in `columns` becomes an absent key rather than a silently wrong number.
 * The tuple-shaped `hogql` in `stats.ts` stays for callers that destructure
 * positionally on purpose; `hogqlNamed` is this path.
 */

/** The parts of a PostHog query response we read. Everything else is ignored. */
export type HogqlResponse = {
  columns?: unknown;
  results?: unknown;
};

/**
 * Zip `columns` and `results` into objects keyed by column name.
 *
 * Anything unexpected degrades to an empty list rather than throwing — a panel
 * that cannot read its own shape must render as "no data", never as a 500 on a
 * dashboard whose other panels are fine.
 *
 * A row that is already an object is passed through untouched, so this stays
 * correct if a future endpoint (or a test fixture) hands back named rows.
 */
export function namedRows<T = Record<string, unknown>>(
  response: HogqlResponse | null | undefined,
): T[] {
  const results = response?.results;
  if (!Array.isArray(results)) return [];

  const columns = response?.columns;
  const names = Array.isArray(columns)
    ? columns.map((c) => (typeof c === "string" ? c : String(c)))
    : [];

  const out: T[] = [];
  for (const row of results) {
    if (row && !Array.isArray(row) && typeof row === "object") {
      out.push(row as T);
      continue;
    }
    if (!Array.isArray(row) || names.length === 0) continue;

    const obj: Record<string, unknown> = {};
    names.forEach((name, i) => {
      obj[name] = row[i];
    });
    out.push(obj as T);
  }
  return out;
}

/**
 * A count from HogQL, as a number a panel can format.
 *
 * `namedRows` can name a value but cannot type it, and ClickHouse hands back
 * 64-bit integers as JSON strings once they are large enough. Coercing at the
 * boundary means nothing downstream has to wonder, and a value that is not a
 * number at all becomes `0` rather than a `NaN` that spreads through every sum,
 * percentage and bar width it touches.
 */
export function toCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** A label from HogQL. Absent properties come back as `''`, never as SQL NULL. */
export function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}
