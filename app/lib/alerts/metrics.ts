/**
 * HallPass — measuring the site, so `rules.ts` can judge it.
 *
 * `server-only`, because it carries the PostHog read credentials. It runs three
 * HogQL queries through the shared transport in `stats.ts` (project-selector
 * fallback, 60s revalidate, 8s timeout, all in one place) and returns raw
 * counts. It decides NOTHING: no averages, no thresholds, no "is this bad". See
 * the header of `rules.ts` for why that line is drawn here.
 *
 * ── FAILURE IS REPORTED, NOT SWALLOWED ─────────────────────────────────────
 * This is the exact inverse of the dashboard's `safe()` wrapper, and the
 * inversion is deliberate. A growth panel that cannot reach PostHog should
 * render as empty rather than take down the page — nobody is misled, because a
 * human is looking at a screen that says so. An ALERT path that degrades to
 * zeros would instead report "no spike, no errors, nothing to see" every half
 * hour, for ever, and look exactly like a healthy site. The one failure mode
 * this feature cannot have is silence that is indistinguishable from good news.
 *
 * So {@link getAlertSnapshot} answers `{ ok: false, reason }`, the route turns
 * that into a 503, and `scripts/check-alerts.mjs` exits non-zero — which makes
 * GitHub mark the run red and mail whoever owns the repository. A broken
 * alerting pipeline announces itself through the same channel as everything else
 * that breaks in CI.
 *
 * ── THE BASELINE IS THE SAME WINDOW ON PREVIOUS DAYS ───────────────────────
 * Not "the last 24 hours", and not the clock hour either. Both sides of every
 * ratio are the SAME sixty minutes of the day, aligned exactly: minutes-ago
 * modulo a day is the offset within the daily cycle, so a run at 13:20 compares
 * 12:20–13:20 today against 12:20–13:20 on each of the previous seven days.
 * `config.ts` explains why a site played from school needs this.
 */

import "server-only";
import { toCount, toText } from "@/app/lib/hogql-rows";
import { hogqlNamed, isStatsConfigured } from "@/app/lib/stats";
import {
  ALERT_WINDOW_MINUTES,
  BASELINE_DAYS,
  CONTENT_GAP_WINDOW_HOURS,
} from "./config";
import type { AlertSnapshot, MissingGame } from "./rules";

/** What counts as a player being here. Matches `stats.ts`'s definition of a play. */
const PLAY_EVENT = "game_started";

/**
 * PostHog's own name for a captured exception. Emitted because
 * `instrumentation-client.ts` sets `capture_exceptions: true`; nothing in this
 * repo raises it by hand, so it covers uncaught errors from the site AND from
 * the games it hosts.
 */
const ERROR_EVENT = "$exception";

/** A measurement that could not be taken, and why. */
export type SnapshotFailure = {
  ok: false;
  /** Human-readable, and safe to print in a CI log — never a credential. */
  reason: string;
  /** False when there is no `POSTHOG_PERSONAL_API_KEY` at all, rather than a query failing. */
  configured: boolean;
};

export type SnapshotResult = { ok: true; snapshot: AlertSnapshot } | SnapshotFailure;

/**
 * The window as it is now: players here, and errors thrown.
 *
 * One query for both, by conditional aggregation, because they are the same scan
 * over the same range — the pattern `stats.ts` uses for its KPI row.
 */
const currentSql = `
  SELECT
    count(DISTINCT if(event = '${PLAY_EVENT}', distinct_id, NULL)) AS visitors,
    countIf(event = '${ERROR_EVENT}') AS errors
  FROM events
  WHERE event IN ('${PLAY_EVENT}', '${ERROR_EVENT}')
    AND timestamp >= now() - INTERVAL ${ALERT_WINDOW_MINUTES} MINUTE
`;

/**
 * The same window on each of the previous days, one row per day.
 *
 * `minutes_ago % (24 * 60) < ALERT_WINDOW_MINUTES` selects the same slot of the
 * daily cycle; the integer division of the same figure names which day it was.
 * Days with no events at all are simply absent from the result — which is the
 * honest answer, and why `rules.ts` counts the samples it got rather than
 * assuming there are {@link BASELINE_DAYS} of them.
 */
const baselineSql = `
  SELECT
    days_ago,
    count(DISTINCT if(event = '${PLAY_EVENT}', distinct_id, NULL)) AS visitors,
    countIf(event = '${ERROR_EVENT}') AS errors
  FROM (
    SELECT
      distinct_id,
      event,
      intDiv(dateDiff('minute', timestamp, now()), 1440) AS days_ago,
      modulo(dateDiff('minute', timestamp, now()), 1440) AS minute_of_day
    FROM events
    WHERE event IN ('${PLAY_EVENT}', '${ERROR_EVENT}')
      AND timestamp >= now() - INTERVAL ${BASELINE_DAYS} DAY - INTERVAL ${ALERT_WINDOW_MINUTES} MINUTE
  )
  WHERE minute_of_day < ${ALERT_WINDOW_MINUTES}
    AND days_ago >= 1
    AND days_ago <= ${BASELINE_DAYS}
  GROUP BY days_ago
  ORDER BY days_ago ASC
`;

/**
 * Games people looked for today and did not find.
 *
 * The prefix-collapse subquery is lifted from `getDashboardStats`'s
 * `zeroResultSql` and changed only in its window, so the alert and the dashboard
 * panel it points at count the same thing. `stats.ts` explains at length why
 * this is not `GROUP BY query`: typing "duskfall" used to emit six events, and
 * ranking those would rank PREFIXES rather than intentions.
 *
 * `properties.results` only exists on events captured since the search debounce
 * shipped, and an event without it is EXCLUDED rather than assumed to be zero —
 * assuming zero would invent a content gap for every search ever made.
 */
const missingGamesSql = `
  SELECT term, count(DISTINCT distinct_id) AS people
  FROM (
    SELECT distinct_id, arrayJoin(
      arrayFilter(x -> NOT arrayExists(y -> y != x AND startsWith(y, x), qs), qs)
    ) AS term
    FROM (
      SELECT distinct_id,
             toStartOfInterval(timestamp, INTERVAL 5 MINUTE) AS bucket,
             groupArray(properties.query) AS qs
      FROM events
      WHERE event = 'game_searched' AND properties.query IS NOT NULL
        AND toInt(properties.results) = 0
        AND timestamp >= now() - INTERVAL ${CONTENT_GAP_WINDOW_HOURS} HOUR
      GROUP BY distinct_id, bucket
    )
  )
  GROUP BY term ORDER BY people DESC, term ASC LIMIT 5
`;

/**
 * Measure the site.
 *
 * The three queries run CONCURRENTLY — they are independent, and a cron holding
 * a Vercel function open for three sequential PostHog round trips is three times
 * the timeout budget for no reason.
 *
 * `takenAt` is stamped here rather than in the rules, which have no clock, and
 * is what the cooldown bucket is derived from downstream.
 */
export async function getAlertSnapshot(now: Date = new Date()): Promise<SnapshotResult> {
  if (!isStatsConfigured()) {
    return {
      ok: false,
      configured: false,
      reason:
        "POSTHOG_PERSONAL_API_KEY is not set, so the site cannot read its own analytics.",
    };
  }

  try {
    const [current, baseline, missing] = await Promise.all([
      hogqlNamed<{ visitors: unknown; errors: unknown }>(currentSql, "alerts-current"),
      hogqlNamed<{ days_ago: unknown; visitors: unknown; errors: unknown }>(
        baselineSql,
        "alerts-baseline",
      ),
      hogqlNamed<{ term: unknown; people: unknown }>(missingGamesSql, "alerts-gaps"),
    ]);

    const missingGames: MissingGame[] = missing
      .map((row) => ({ term: toText(row.term).trim(), people: toCount(row.people) }))
      .filter((row) => row.term.length > 0);

    return {
      ok: true,
      snapshot: {
        takenAt: now.toISOString(),
        windowMinutes: ALERT_WINDOW_MINUTES,
        current: {
          visitors: toCount(current[0]?.visitors),
          errors: toCount(current[0]?.errors),
        },
        baseline: {
          visitors: baseline.map((row) => toCount(row.visitors)),
          errors: baseline.map((row) => toCount(row.errors)),
        },
        missingGames,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown PostHog error";
    console.error("[alerts] snapshot failed:", reason);
    return { ok: false, configured: true, reason };
  }
}
