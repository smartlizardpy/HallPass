/**
 * HallPass — the pure arithmetic behind the dashboard overview.
 *
 * Deliberately free of `server-only`, a database handle and `fetch` (the same
 * reasoning as `hogql-rows.ts`): every panel on `/dashboard` is fed by numbers
 * that get shaped BEFORE they reach a chart, and shaping is exactly the part
 * that is easy to get quietly wrong. A period comparison that divides by a zero
 * baseline, a 30-day series that silently omits the days nothing happened, an
 * hour-of-day chart that jumps from 09:00 to 14:00 — none of those throw, they
 * just render a confident lie. Keeping the arithmetic here means it is unit
 * tested rather than eyeballed on a dashboard nobody can reproduce locally.
 *
 * Two rules hold throughout:
 *   * A missing baseline is `null`, never `0` and never `Infinity`. "No previous
 *     data" and "no change" are different statements and the UI renders them
 *     differently.
 *   * A gap in a time series is a ZERO, not an absent point. SQL `GROUP BY day`
 *     returns only the days with rows, so an un-filled series draws a line
 *     straight over a quiet weekend as though play were continuous.
 */

/** A value against the equal-length preceding period. */
export type Delta = {
  /** Current-period value. */
  value: number;
  /** Previous equal-length period value. */
  prev: number;
  /** Percent change vs. the previous period; `null` when there is no baseline. */
  pct: number | null;
};

/**
 * Build a {@link Delta}.
 *
 * `pct` is `null` whenever the baseline is zero — the honest answer to "what is
 * the percentage growth from nothing?", which is not 100% and not infinity. The
 * dashboard renders that case as "— new" instead of a number.
 */
export function delta(value: number, prev: number): Delta {
  const pct = prev > 0 ? ((value - prev) / prev) * 100 : null;
  return { value, prev, pct };
}

/** `YYYY-MM-DD` for a date, in UTC — the key format every daily query returns. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The last `days` day-keys ending at `end` (inclusive), oldest first.
 *
 * UTC throughout, because the daily SQL buckets on the database's clock (Neon
 * runs UTC) and PostHog buckets on the project's. Deriving the skeleton from
 * local time would shift every bucket by the server's offset and drop or
 * duplicate a day at the edges.
 */
export function dayKeys(days: number, end: Date): string[] {
  const keys: string[] = [];
  const cursor = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
  );
  for (let i = days - 1; i >= 0; i--) {
    keys.push(dayKey(new Date(cursor - i * 86_400_000)));
  }
  return keys;
}

/**
 * Zero-fill a sparse daily result set into a dense `days`-long series.
 *
 * `GROUP BY day` only returns days that HAVE rows, so a series straight from SQL
 * draws a smooth line across the days when nobody signed in — the exact opposite
 * of what those days mean. `blank` mints the zero row so callers keep their own
 * row shape, and a row outside the window is dropped rather than appended (a
 * stray date must not stretch the axis).
 */
export function fillDays<T extends { date: string }>(
  rows: T[],
  days: number,
  end: Date,
  blank: (date: string) => T,
): T[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return dayKeys(days, end).map((date) => byDate.get(date) ?? blank(date));
}

/** One hour of the day, `hour` in 0–23. */
export type HourBucket = { hour: number; value: number };

/**
 * Zero-fill an hour-of-day histogram to all 24 hours, midnight first.
 *
 * Same gap problem as {@link fillDays}, with a sharper edge: a school arcade is
 * genuinely dead at 03:00, and a chart that simply omits the small hours makes
 * the quiet part of the day invisible instead of informative. Out-of-range and
 * duplicate hours are ignored — the shape is fixed at 24 buckets by definition.
 */
export function fillHours(rows: HourBucket[]): HourBucket[] {
  const byHour = new Map<number, number>();
  for (const row of rows) {
    if (!Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23) continue;
    byHour.set(row.hour, (byHour.get(row.hour) ?? 0) + row.value);
  }
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    value: byHour.get(hour) ?? 0,
  }));
}

/** Compact clock label for an hour bucket: `0 → "12a"`, `13 → "1p"`. */
export function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "a" : "p";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

/**
 * Weekday name for a ClickHouse `toDayOfWeek` index — 1 = Monday … 7 = Sunday.
 *
 * ISO numbering, NOT JavaScript's `Date.getDay()` (0 = Sunday). Mixing the two
 * is a silent off-by-one that relabels every bar on the chart, so the conversion
 * lives here with the test that pins it rather than inline at a call site.
 */
export function weekdayLabel(index: number): string {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return names[index - 1] ?? "—";
}

/**
 * `part` as a percentage of `whole`, or `null` when there is nothing to divide.
 *
 * Rounded to one decimal: these are ratios read at a glance ("62.5% of scores
 * are signed in"), and full float precision is noise on a KPI card.
 */
export function share(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) {
    return null;
  }
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * The highest-scoring row, or `null` for an empty list. Ties keep the FIRST row,
 * so a chronological series reports the earliest peak — "the busiest day was
 * Monday" should not drift to a later, equal day as more data arrives.
 */
export function peak<T>(rows: T[], value: (row: T) => number): T | null {
  let best: T | null = null;
  let bestValue = -Infinity;
  for (const row of rows) {
    const current = value(row);
    if (current > bestValue) {
      best = row;
      bestValue = current;
    }
  }
  return best;
}

/**
 * Short "how long ago" label for a timestamp: `today`, `3d`, `2w`, `5mo`, `1y`.
 *
 * Used on the newest-player chips, where the point is ordering and recency at a
 * glance rather than a precise date. Anything in the future (clock skew between
 * the database and the renderer) reads as `today` rather than a negative age.
 * An unparseable timestamp returns `null` so the caller can render nothing.
 */
export function agoLabel(iso: string, now: Date): string | null {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const days = Math.floor((now.getTime() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
