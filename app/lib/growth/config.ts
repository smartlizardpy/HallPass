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
 * The earliest instant we will believe an event carries.
 *
 * `max(timestamp)` over an empty range does NOT come back as SQL NULL: ClickHouse
 * yields the type's default, so "this project has never received an event"
 * arrives looking like an event from 1 January 1970. Rendered as-is the panel
 * would report a newest event from before the web existed instead of saying
 * there are none — and `isReportingHealthy` would call it a stall rather than a
 * silence. Anything before HallPass existed is that default, not a real event.
 */
const EARLIEST_PLAUSIBLE_EVENT = Date.UTC(2020, 0, 1);

/** `2026-08-17 13:45:12.000000`, `2026-08-17T13:45:12Z`, and the variants between. */
const HOGQL_DATETIME =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Normalise the newest-event timestamp PostHog returns into a UTC ISO string.
 *
 * HogQL renders a DateTime as `2026-08-17 13:45:12.000000` — a SPACE rather than
 * a `T`, and no zone. `new Date()` reads that through its legacy parser as LOCAL
 * time, so on any server not running in UTC the freshness check silently
 * measures staleness against a clock hours from the one the event was stamped
 * on: an hour-old event can read as seven hours stale, or as arriving in the
 * future. PostHog stores UTC, so it is read as UTC unless an offset says
 * otherwise.
 *
 * `null` means "no event", and it is returned for every value that cannot be a
 * real one — absent, unparseable, or the epoch default above. That keeps
 * "PostHog has never heard from us" a distinct state from "PostHog stopped
 * hearing from us", which is the distinction the whole panel turns on.
 */
export function normaliseLastEvent(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "") return null;

  const parts = HOGQL_DATETIME.exec(text);
  const iso = parts ? `${parts[1]}T${parts[2]}${parts[3] ?? "Z"}` : text;

  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < EARLIEST_PLAUSIBLE_EVENT) return null;
  return new Date(ms).toISOString();
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
