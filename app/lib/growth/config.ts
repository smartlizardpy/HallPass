/**
 * HallPass — growth-panel tunables and pure maths.
 *
 * Mirrors `challenges/config.ts` and `social/config.ts`: pure, no `server-only`,
 * so the numbers a panel renders can be unit-tested without a database and the
 * client components can share the same constants the server queries were built
 * around. `share-loop.ts` and `acquisition.ts` are the server-only halves.
 */

/**
 * How many weeks of history the share-loop series carries.
 *
 * Interpolated into SQL through `make_interval(weeks => …)` rather than into an
 * `INTERVAL '… weeks'` literal: the `sql` tag turns every `${}` into a bound
 * parameter, so the literal form would emit `INTERVAL '$1 weeks'` — a string
 * containing the characters `$1`, not a bound value — and fail.
 */
export const SHARE_LOOP_WEEKS = 12;

/** Rolling window every acquisition KPI is measured over, in days. */
export const ACQUISITION_WINDOW_DAYS = 30;

/**
 * How stale the newest event may be before the dashboard stops calling analytics
 * healthy.
 *
 * The failure this exists for: a school content filter, an ad blocker or a
 * missing build-time token all produce the SAME picture as genuinely having no
 * visitors — a row of zeros. One means "our marketing did nothing", the other
 * means "our analytics stopped", and a panel that cannot tell them apart will be
 * read as the first every time. Six hours is comfortably longer than any quiet
 * overnight stretch and far shorter than an outage worth knowing about.
 */
export const REPORTING_STALE_AFTER_HOURS = 6;

/** A week in the share-loop series. `week` is the ISO date of its Monday. */
export type ShareWeek = {
  week: string;
  links: number;
  claims: number;
};

/**
 * Claims per link — the loop's branching factor.
 *
 * Zero links is `null`, meaning "no data", and NOT `0`: a zero would read on the
 * panel as a loop that exists and is failing, rather than one nobody has used
 * yet. Those are different facts and only one of them is a problem.
 */
export function claimsPerLink(links: number, claims: number): number | null {
  if (!Number.isFinite(links) || !Number.isFinite(claims)) return null;
  if (links <= 0) return null;
  return claims / links;
}

/**
 * Weeks of the share loop, oldest first, with gaps filled.
 *
 * A week nobody shared in must appear as a zero rather than be absent: a line
 * chart that silently closes the gap draws a slope between two distant points
 * and invents activity that never happened.
 *
 * Weeks are snapped to Monday in UTC, matching Postgres' `date_trunc('week', …)`
 * so the keys line up with what the query emits.
 */
export function fillWeeks(
  rows: readonly ShareWeek[],
  weeks: number,
  today: Date,
): ShareWeek[] {
  const byWeek = new Map(rows.map((r) => [r.week, r]));

  const monday = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const weekday = (monday.getUTCDay() + 6) % 7; // Mon = 0
  monday.setUTCDate(monday.getUTCDate() - weekday);

  const out: ShareWeek[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const key = d.toISOString().slice(0, 10);
    out.push(byWeek.get(key) ?? { week: key, links: 0, claims: 0 });
  }
  return out;
}

/**
 * Is analytics still reporting?
 *
 * `null` means nothing has ever been received, which is a third state again —
 * a project that has never captured an event, rather than one that stopped.
 */
export function isReportingHealthy(
  lastEventAt: string | null,
  now: Date,
): boolean {
  if (!lastEventAt) return false;
  const seen = new Date(lastEventAt).getTime();
  if (!Number.isFinite(seen)) return false;
  return now.getTime() - seen < REPORTING_STALE_AFTER_HOURS * 3600_000;
}
