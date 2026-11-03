/**
 * HallPass — a game's lifetime play history, as a chart series.
 *
 * Pure (no `server-only`, no I/O) so it is unit-tested directly. `stats.ts`
 * fetches the per-day PostHog counts; this turns them into one point per
 * calendar day from the game's first play to today, with the days nobody played
 * filled in as zero, and a running total alongside.
 */

export type DailyPlayRow = { date: string; plays: number };
export type LifetimePoint = { date: string; plays: number; total: number };

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` in UTC. */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * One point per day from the earliest row to `today` (inclusive), cumulative.
 *
 * `baseline` is plays counted before PostHog's own history begins (the seeded
 * part of the permanent total); it offsets the running total so the last point
 * lines up with the number printed on the public pages.
 */
export function buildLifetimeSeries(
  rows: DailyPlayRow[],
  today: Date = new Date(),
  baseline = 0,
): LifetimePoint[] {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const plays = Number(row.plays);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(plays) || plays < 0) continue;
    byDay.set(row.date, (byDay.get(row.date) ?? 0) + plays);
  }
  if (byDay.size === 0) return [];

  const first = Date.parse(`${[...byDay.keys()].sort()[0]}T00:00:00Z`);
  const last = Math.max(Date.parse(`${isoDay(today.getTime())}T00:00:00Z`), first);

  const out: LifetimePoint[] = [];
  let total = Math.max(0, Math.floor(baseline));
  for (let t = first; t <= last; t += DAY_MS) {
    const date = isoDay(t);
    const plays = byDay.get(date) ?? 0;
    total += plays;
    out.push({ date, plays, total });
  }
  return out;
}
