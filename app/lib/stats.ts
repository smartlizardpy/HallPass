import "server-only";

export type PlayCounts = Record<string, number>;

const API_HOST = process.env.POSTHOG_API_HOST ?? "https://eu.posthog.com";
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const QUERY_ENDPOINT_SELECTORS = PROJECT_ID ? [PROJECT_ID, "@current"] : ["@current"];

function getQueryEndpoint(projectSelector: string) {
  return `${API_HOST}/api/projects/${projectSelector}/query/`;
}

async function hogql<T = unknown>(
  sql: string,
  tag = "posthog-stats",
): Promise<T[]> {
  if (!API_KEY) return [];
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
      const data = (await res.json()) as { results?: T[] };
      return data.results ?? [];
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

/** Run a secondary panel query that must NEVER blank the whole dashboard. */
function safe<T>(p: Promise<T[]>): Promise<T[]> {
  return p.catch(() => [] as T[]);
}

// Events that count as "a play". Only `game_started` — it fires once for every
// game open (Arcade `setPlaying`), including featured ones. The featured banner
// ALSO fires `featured_game_played`, so counting both double-counted every
// featured play; that event is kept purely as a supplementary engagement signal.
const PLAY_EVENTS = "('game_started')";

export type Delta = {
  /** Current-period value. */
  value: number;
  /** Previous equal-length period value. */
  prev: number;
  /** Percent change vs. the previous period; `null` when there is no baseline. */
  pct: number | null;
};

function delta(value: number, prev: number): Delta {
  const pct = prev > 0 ? ((value - prev) / prev) * 100 : null;
  return { value, prev, pct };
}

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

  const searchSql = `
    SELECT properties.query AS term, count() AS n
    FROM events
    WHERE event = 'game_searched' AND properties.query IS NOT NULL
      AND timestamp >= now() - INTERVAL 30 DAY
    GROUP BY term ORDER BY n DESC LIMIT 8
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
    const [kpi, daily, top, cats, searches, countries, devices] = await Promise.all([
      hogql<[number, number, number, number, number, number, number]>(kpiSql),
      safe(hogql<[string, number, number, number]>(dailySql)),
      safe(hogql<[string, number]>(topSql)),
      safe(hogql<[string, number]>(catSql)),
      safe(hogql<[string, number]>(searchSql)),
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
