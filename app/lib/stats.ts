import "server-only";

import { type HogqlResponse, namedRows } from "@/app/lib/hogql-rows";
import { type Delta, delta } from "@/app/lib/insights";

/**
 * Re-exported so the dashboard keeps importing its KPI types from the module
 * that produces them. The definition itself lives in `insights.ts` with the
 * arithmetic, because the community panel computes the same shape against the
 * database and two definitions of "percent change" would drift.
 */
export type { Delta };

export type PlayCounts = Record<string, number>;

const API_HOST = process.env.POSTHOG_API_HOST ?? "https://eu.posthog.com";
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;

/**
 * Is server-side PostHog reading configured at all?
 *
 * Distinct from "is analytics healthy" — this is about OUR read credentials
 * (`POSTHOG_PERSONAL_API_KEY`), not about whether the browser is still able to
 * send events. The growth page has to tell those apart to say anything useful
 * about a screen full of zeros.
 */
export function isStatsConfigured(): boolean {
  return Boolean(API_KEY);
}
const QUERY_ENDPOINT_SELECTORS = PROJECT_ID ? [PROJECT_ID, "@current"] : ["@current"];

function getQueryEndpoint(projectSelector: string) {
  return `${API_HOST}/api/projects/${projectSelector}/query/`;
}

/**
 * Run one HogQL query against PostHog and hand back the raw response body.
 *
 * The single place the transport lives, because the things worth not
 * duplicating are the project-selector fallback (a personal API key that cannot
 * see `POSTHOG_PROJECT_ID` retries against `@current`), the 60s revalidate that
 * keeps a dashboard render from hammering the API, the 8s timeout, and the "no
 * key means empty, not a throw" contract every caller is written against. A
 * second copy would drift on all four.
 *
 * `hogql` and `hogqlNamed` are the two ways to read what it returns; see them
 * for which shape to ask for.
 */
async function runHogql(sql: string, tag: string): Promise<HogqlResponse> {
  if (!API_KEY) return {};
  let lastError: Error | undefined;

  for (const selector of QUERY_ENDPOINT_SELECTORS) {
    const res = await fetch(getQueryEndpoint(selector), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: sql } }),
      // Dashboard stays near-live: PostHog caches query results ~60s anyway, so
      // a 60s window is about as fresh as it gets without hammering the API.
      next: { revalidate: 60, tags: [tag] },
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      return (await res.json()) as HogqlResponse;
    }

    const errorText = await res.text();
    const projectNotFound =
      res.status === 404 && errorText.toLowerCase().includes("project not found");

    if (projectNotFound && selector !== "@current") {
      lastError = new Error(
        `PostHog project ${selector} is not accessible with this API key; retrying with @current`,
      );
      continue;
    }

    throw new Error(`PostHog query failed with status ${res.status}: ${errorText}`);
  }

  throw lastError ?? new Error("PostHog query failed");
}

/**
 * Rows as PostHog sends them: POSITIONAL TUPLES, one value per selected column,
 * in `SELECT` order. `hogql<[string, number]>(…)` then destructures them.
 *
 * That shape is not obvious from the call site, and typing it as objects instead
 * is silent rather than loud — see the header of `hogql-rows.ts` for the growth
 * page that spent a release reporting zeros because of it. Prefer `hogqlNamed`
 * for anything with more than a couple of columns.
 *
 * Returns `[]` — never throws — when there is no API key configured.
 */
export async function hogql<T = unknown>(
  sql: string,
  tag = "posthog-stats",
): Promise<T[]> {
  const data = await runHogql(sql, tag);
  return Array.isArray(data.results) ? (data.results as T[]) : [];
}

/**
 * The same query, with each row zipped against the response's `columns` so it
 * can be read by name.
 *
 * Costs one object per row and removes an entire class of silent wrongness:
 * a column that was never selected reads as an absent key rather than as a
 * plausible number. Values are still whatever JSON PostHog sent, so pair it with
 * `toCount` / `toText` at the boundary.
 */
export async function hogqlNamed<T = Record<string, unknown>>(
  sql: string,
  tag = "posthog-stats",
): Promise<T[]> {
  return namedRows<T>(await runHogql(sql, tag));
}

/** Run a secondary panel query that must NEVER blank the whole dashboard. */
function safe<T>(p: Promise<T[]>): Promise<T[]> {
  return p.catch(() => [] as T[]);
}

// Events that count as "a play". Only `game_started` — it fires once for every
// game open (Arcade `setPlaying`), including featured ones. The featured banner
// ALSO fires `featured_game_played`, so counting both double-counted every
// featured play; that event is kept purely as a supplementary engagement signal.
const PLAY_EVENTS = "('game_started')";

export type DailyPlays = { date: string; plays: number; visitors: number; searches: number };
export type LabeledCount = { label: string; value: number };
export type TopGame = { slug: string; plays: number };

export type DashboardStats = {
  totalPlays: number;
  uniqueVisitors: number;
  searches: number;
  adClicks: number;
  playsDelta: Delta;
  visitorsDelta: Delta;
  searchesDelta: Delta;
  topGames: TopGame[];
  daily: DailyPlays[];
  categories: LabeledCount[];
  searchTerms: LabeledCount[];
  /** Searches that matched no game — the next games to add. */
  zeroResultTerms: LabeledCount[];
  countries: LabeledCount[];
  devices: LabeledCount[];
  configured: boolean;
  unavailable: boolean;
  unavailableReason?: string;
};

const EMPTY_STATS: DashboardStats = {
  totalPlays: 0,
  uniqueVisitors: 0,
  searches: 0,
  adClicks: 0,
  playsDelta: { value: 0, prev: 0, pct: null },
  visitorsDelta: { value: 0, prev: 0, pct: null },
  searchesDelta: { value: 0, prev: 0, pct: null },
  topGames: [],
  daily: [],
  categories: [],
  searchTerms: [],
  zeroResultTerms: [],
  countries: [],
  devices: [],
  configured: false,
  unavailable: false,
};

export async function getDashboardStats(): Promise<DashboardStats> {
  if (!API_KEY) return { ...EMPTY_STATS, configured: false };

  // One headline query computes every KPI for both the current 30-day window and
  // the preceding 30-day window (for deltas) via conditional aggregation.
  const kpiSql = `
    SELECT
      countIf(event IN ${PLAY_EVENTS} AND timestamp >= now() - INTERVAL 30 DAY) AS plays_now,
      countIf(event IN ${PLAY_EVENTS} AND timestamp >= now() - INTERVAL 60 DAY AND timestamp < now() - INTERVAL 30 DAY) AS plays_prev,
      count(DISTINCT if(event IN ${PLAY_EVENTS} AND timestamp >= now() - INTERVAL 30 DAY, distinct_id, NULL)) AS visitors_now,
      count(DISTINCT if(event IN ${PLAY_EVENTS} AND timestamp >= now() - INTERVAL 60 DAY AND timestamp < now() - INTERVAL 30 DAY, distinct_id, NULL)) AS visitors_prev,
      countIf(event = 'game_searched' AND timestamp >= now() - INTERVAL 30 DAY) AS searches_now,
      countIf(event = 'game_searched' AND timestamp >= now() - INTERVAL 60 DAY AND timestamp < now() - INTERVAL 30 DAY) AS searches_prev,
      countIf(event = 'ad_clicked' AND timestamp >= now() - INTERVAL 30 DAY) AS ad_clicks
    FROM events
    WHERE timestamp >= now() - INTERVAL 60 DAY
      AND event IN ('game_started', 'game_searched', 'ad_clicked')
  `;

  const dailySql = `
    SELECT toString(toDate(timestamp)) AS date,
      countIf(event IN ${PLAY_EVENTS}) AS plays,
      count(DISTINCT if(event IN ${PLAY_EVENTS}, distinct_id, NULL)) AS visitors,
      countIf(event = 'game_searched') AS searches
    FROM events
    WHERE event IN ('game_started', 'game_searched')
      AND timestamp >= now() - INTERVAL 30 DAY
    GROUP BY date ORDER BY date ASC
  `;

  const topSql = `
    SELECT properties.game_slug AS slug, count() AS plays
    FROM events
    WHERE event IN ${PLAY_EVENTS} AND properties.game_slug IS NOT NULL
      AND timestamp >= now() - INTERVAL 30 DAY
    GROUP BY slug ORDER BY plays DESC LIMIT 8
  `;

  const catSql = `
    SELECT properties.game_category AS category, count() AS plays
    FROM events
    WHERE event IN ${PLAY_EVENTS} AND properties.game_category IS NOT NULL
      AND timestamp >= now() - INTERVAL 30 DAY
    GROUP BY category ORDER BY plays DESC LIMIT 8
  `;

  /**
   * Top searches, with PREFIX CHAINS COLLAPSED and counted by PEOPLE.
   *
   * Search used to be captured on every keystroke, so typing "duskfall" emitted
   * six events and the old `GROUP BY query, count()` ranked PREFIXES rather than
   * intentions — a real result read `ter 2 / terr 1 / dus 1 / dusk 1`, which is
   * two people typing two words. `SiteHeader` now debounces, so new data arrives
   * clean, but thirty days of the old shape is still in range and the same
   * collapse is wanted anyway whenever a player backspaces.
   *
   * The inner query buckets each person's searches into five-minute bursts and
   * keeps a term only when NOTHING ELSE in that burst extends it. That is
   * deliberately not `argMax(query, timestamp)`, which looks equivalent and is
   * not: taking only the last query per burst would silently discard a genuine
   * second search, so somebody who looked for "terraria" and then "duskfall"
   * would be recorded as having only wanted the latter.
   *
   * Ranked by DISTINCT PEOPLE, so one indecisive player cannot outrank five who
   * all wanted the same thing.
   */
  const searchSql = `
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
          AND timestamp >= now() - INTERVAL 30 DAY
        GROUP BY distinct_id, bucket
      )
    )
    GROUP BY term ORDER BY people DESC, term ASC LIMIT 8
  `;

  /**
   * Searches that found NOTHING — the only search metric that is directly
   * actionable.
   *
   * "Eleven people looked for a game you do not have" names the next game to
   * add. Same prefix collapse as above, then filtered to bursts whose terminal
   * query matched zero games.
   *
   * `properties.results` only exists on events captured after the debounce
   * shipped, so this panel fills in from that date rather than backfilling. An
   * event without the property is excluded rather than assumed to be zero —
   * assuming zero would invent a content gap for every search ever made.
   */
  const zeroResultSql = `
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
          AND timestamp >= now() - INTERVAL 30 DAY
        GROUP BY distinct_id, bucket
      )
    )
    GROUP BY term ORDER BY people DESC, term ASC LIMIT 8
  `;

  const countrySql = `
    SELECT properties.$geoip_country_name AS country, count(DISTINCT distinct_id) AS visitors
    FROM events
    WHERE event IN ${PLAY_EVENTS} AND properties.$geoip_country_name IS NOT NULL
      AND timestamp >= now() - INTERVAL 30 DAY
    GROUP BY country ORDER BY visitors DESC LIMIT 6
  `;

  const deviceSql = `
    SELECT properties.$device_type AS device, count() AS plays
    FROM events
    WHERE event IN ${PLAY_EVENTS} AND properties.$device_type IS NOT NULL
      AND timestamp >= now() - INTERVAL 30 DAY
    GROUP BY device ORDER BY plays DESC LIMIT 4
  `;

  try {
    // The KPI query is critical (its failure marks the dashboard unavailable);
    // every secondary panel degrades to empty on its own without taking the
    // others down.
    const [kpi, daily, top, cats, searches, zeroResults, countries, devices] = await Promise.all([
      hogql<[number, number, number, number, number, number, number]>(kpiSql),
      safe(hogql<[string, number, number, number]>(dailySql)),
      safe(hogql<[string, number]>(topSql)),
      safe(hogql<[string, number]>(catSql)),
      safe(hogql<[string, number]>(searchSql)),
      safe(hogql<[string, number]>(zeroResultSql)),
      safe(hogql<[string, number]>(countrySql)),
      safe(hogql<[string, number]>(deviceSql)),
    ]);

    const [
      playsNow = 0,
      playsPrev = 0,
      visitorsNow = 0,
      visitorsPrev = 0,
      searchesNow = 0,
      searchesPrev = 0,
      adClicks = 0,
    ] = kpi[0] ?? [];

    const num = (v: unknown) => Number(v) || 0;

    return {
      totalPlays: num(playsNow),
      uniqueVisitors: num(visitorsNow),
      searches: num(searchesNow),
      adClicks: num(adClicks),
      playsDelta: delta(num(playsNow), num(playsPrev)),
      visitorsDelta: delta(num(visitorsNow), num(visitorsPrev)),
      searchesDelta: delta(num(searchesNow), num(searchesPrev)),
      topGames: top.map(([slug, plays]) => ({ slug, plays: num(plays) })),
      daily: daily.map(([date, plays, visitors, searches]) => ({
        date,
        plays: num(plays),
        visitors: num(visitors),
        searches: num(searches),
      })),
      categories: cats.map(([label, value]) => ({ label, value: num(value) })),
      searchTerms: searches.map(([label, value]) => ({ label, value: num(value) })),
      zeroResultTerms: zeroResults.map(([label, value]) => ({ label, value: num(value) })),
      countries: countries.map(([label, value]) => ({ label, value: num(value) })),
      devices: devices.map(([label, value]) => ({ label, value: num(value) })),
      configured: true,
      unavailable: false,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown PostHog error";
    console.error("Failed to load dashboard stats:", reason);
    return { ...EMPTY_STATS, configured: true, unavailable: true, unavailableReason: reason };
  }
}

export async function getGamePlayCounts(): Promise<PlayCounts> {
  if (!API_KEY) return {};

  const query = {
    query: {
      kind: "HogQLQuery",
      query: `
        SELECT properties.game_slug AS slug, count() AS plays
        FROM events
        WHERE event IN ${PLAY_EVENTS}
          AND properties.game_slug IS NOT NULL
          AND timestamp >= now() - INTERVAL 30 DAY
        GROUP BY slug
      `,
    },
  };

  try {
    for (const selector of QUERY_ENDPOINT_SELECTORS) {
      const res = await fetch(getQueryEndpoint(selector), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(query),
        // Homepage card counts are vanity numbers on a high-traffic page, so a
        // 5-minute window keeps them fresh-ish without a PostHog hit per render.
        next: { revalidate: 300, tags: ["game-play-counts"] },
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = (await res.json()) as { results?: [string, number][] };
        const counts: PlayCounts = {};
        for (const [slug, plays] of data.results ?? []) {
          if (slug) counts[slug] = Number(plays) || 0;
        }
        return counts;
      }

      const errorText = await res.text();
      const projectNotFound =
        res.status === 404 && errorText.toLowerCase().includes("project not found");

      if (projectNotFound && selector !== "@current") continue;
      return {};
    }
  } catch {
    // Never let the home page's play-count enrichment throw — degrade to none.
    return {};
  }

  return {};
}
