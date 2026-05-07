import "server-only";

export type PlayCounts = Record<string, number>;

const API_HOST = process.env.POSTHOG_API_HOST ?? "https://eu.posthog.com";
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const QUERY_ENDPOINT_SELECTORS = PROJECT_ID ? [PROJECT_ID, "@current"] : ["@current"];

function getQueryEndpoint(projectSelector: string) {
  return `${API_HOST}/api/projects/${projectSelector}/query/`;
}

async function hogql<T = unknown>(sql: string): Promise<T[]> {
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
      next: { revalidate: 3600, tags: ["posthog-stats"] },
      signal: AbortSignal.timeout(5000),
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
        `PostHog project ${selector} is not accessible with this API key; retrying with @current`
      );
      continue;
    }

    throw new Error(`PostHog query failed with status ${res.status}: ${errorText}`);
  }

  throw lastError ?? new Error("PostHog query failed");
}

export type DailyPlays = { date: string; plays: number };
export type CategoryCount = { category: string; plays: number };
export type DashboardStats = {
  totalPlays: number;
  uniqueVisitors: number;
  topGames: { slug: string; plays: number }[];
  daily: DailyPlays[];
  configured: boolean;
  unavailable: boolean;
  unavailableReason?: string;
};

export async function getDashboardStats(): Promise<DashboardStats> {
  if (!API_KEY) {
    return {
      totalPlays: 0,
      uniqueVisitors: 0,
      topGames: [],
      daily: [],
      configured: false,
      unavailable: false,
      unavailableReason: undefined,
    };
  }

  try {
    const [totals, top, daily] = await Promise.all([
      hogql<[number, number]>(`
        SELECT count() AS plays, count(DISTINCT distinct_id) AS visitors
        FROM events
        WHERE event IN ('game_started', 'featured_game_played')
          AND timestamp >= now() - INTERVAL 30 DAY
      `),
      hogql<[string, number]>(`
        SELECT properties.game_slug AS slug, count() AS plays
        FROM events
        WHERE event IN ('game_started', 'featured_game_played')
          AND properties.game_slug IS NOT NULL
          AND timestamp >= now() - INTERVAL 30 DAY
        GROUP BY slug
        ORDER BY plays DESC
        LIMIT 10
      `),
      hogql<[string, number]>(`
        SELECT toString(toDate(timestamp)) AS date, count() AS plays
        FROM events
        WHERE event IN ('game_started', 'featured_game_played')
          AND timestamp >= now() - INTERVAL 14 DAY
        GROUP BY date
        ORDER BY date ASC
      `),
    ]);

    const [totalPlays = 0, uniqueVisitors = 0] = totals[0] ?? [];
    return {
      totalPlays: Number(totalPlays) || 0,
      uniqueVisitors: Number(uniqueVisitors) || 0,
      topGames: top.map(([slug, plays]) => ({ slug, plays: Number(plays) || 0 })),
      daily: daily.map(([date, plays]) => ({ date, plays: Number(plays) || 0 })),
      configured: true,
      unavailable: false,
      unavailableReason: undefined,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown PostHog error";
    console.error("Failed to load dashboard stats:", reason);
    return {
      totalPlays: 0,
      uniqueVisitors: 0,
      topGames: [],
      daily: [],
      configured: true,
      unavailable: true,
      unavailableReason: reason,
    };
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
        WHERE event IN ('game_started', 'featured_game_played')
          AND properties.game_slug IS NOT NULL
          AND timestamp >= now() - INTERVAL 30 DAY
        GROUP BY slug
      `,
    },
  };

  for (const selector of QUERY_ENDPOINT_SELECTORS) {
    const res = await fetch(getQueryEndpoint(selector), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(query),
      next: { revalidate: 3600, tags: ["game-play-counts"] },
      signal: AbortSignal.timeout(5000),
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

    if (projectNotFound && selector !== "@current") {
      continue;
    }

    return {};
  }

  return {};
}
