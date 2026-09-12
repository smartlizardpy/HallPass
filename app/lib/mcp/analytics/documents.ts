import "server-only";

/**
 * HallPass — building the analytics documents `search` and `fetch` hand back.
 *
 * SERVER-ONLY: assembling a document reads PostHog and Neon. The catalogue and
 * the ranking are in `doc-index.ts`, which is pure and carries the tests.
 *
 * ── WHY `text` IS PROSE AND NOT A JSON BLOB ───────────────────────────────
 * `fetch` returns a `text` field that an assistant reads and then answers a
 * person from, usually on a phone. A serialised `DashboardStats` is a correct
 * answer to the wrong question: it is 8 kB of nested objects, most of it
 * irrelevant to whatever was asked, and it pushes the assistant into
 * re-deriving numbers it could have quoted.
 *
 * So each document renders the SAME numbers as lines a human could read —
 * "Plays: 1,204 (up 18% on the previous 30 days)" — with the caveats attached
 * where they apply. That is also what makes the citation honest: the URL points
 * at a dashboard screen showing exactly these lines.
 */

import { getDashboardStats, isStatsConfigured } from "@/app/lib/stats";
import { getCommunityStats, WINDOW_DAYS } from "@/app/lib/overview";
import { getAcquisition } from "@/app/lib/growth/acquisition";
import { getShareLoop } from "@/app/lib/growth/share-loop";
import { getContentHealth } from "@/app/lib/growth/content-health";
import { getAlertSnapshot } from "@/app/lib/alerts/metrics";
import { evaluateAlerts } from "@/app/lib/alerts/rules";
import { resolveGames } from "@/app/lib/games-store";
import { share } from "@/app/lib/insights";
import { SITE_URL } from "@/app/lib/site";
import {
  BOARD_DOC_PREFIX,
  FIXED_DOCS,
  GAME_DOC_PREFIX,
  type DocRef,
} from "./doc-index";
import { METRIC_DEFINITIONS, POSTHOG_EVENTS } from "./definitions";
import { describeAnalyticsViews, isAnalyticsDbConfigured } from "./db";

/** A fetched document, in the shape the hosted assistants expect. */
export type AnalyticsDocument = {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: Record<string, string>;
};

const nf = new Intl.NumberFormat("en-US");
const n = (value: number) => nf.format(Math.round(value));

/**
 * "1,204 (up 18% on the previous 30 days, from 1,020)" — a windowed number and
 * its comparison.
 *
 * TAKES THE DELTA'S OWN `value`, never a separate total, and that is a
 * correction rather than a style choice. The first version of this rendered
 * `withDelta(community.players, community.playersDelta)` and produced
 * "Registered players: 2 (down 100% on the previous 30 days, from 1)" — which
 * is two different quantities welded into one sentence. `players` is the
 * ALL-TIME count; `playersDelta` is about sign-ups IN THE WINDOW. The dashboard
 * gets away with showing them together because they sit in separate visual
 * slots with separate labels; prose has no such slots, so a total and a
 * windowed change have to be separate sentences. See {@link total} below.
 */
function withDelta(delta: { value: number; prev: number; pct: number | null }): string {
  if (delta.pct === null) {
    return `${n(delta.value)} (no comparable previous period)`;
  }
  const direction = delta.pct >= 0 ? "up" : "down";
  return `${n(delta.value)} (${direction} ${Math.abs(Math.round(delta.pct))}% on the previous ${WINDOW_DAYS} days, from ${n(delta.prev)})`;
}

/** An all-time total, labelled as one so it cannot be read as a window. */
function total(value: number): string {
  return `${n(value)} in total, all time`;
}

function list(lines: (string | null | undefined)[]): string {
  return lines.filter(Boolean).join("\n");
}

/** Where the fixed reports point for their citation. */
const FIXED_URLS: Record<string, string> = {
  overview: `${SITE_URL}/dashboard`,
  growth: `${SITE_URL}/dashboard/growth`,
  "content-health": `${SITE_URL}/dashboard/growth`,
  alerts: `${SITE_URL}/dashboard`,
  metrics: `${SITE_URL}/dashboard`,
  schema: `${SITE_URL}/dashboard/mcp`,
};

/**
 * Every document that currently exists, for `search` to rank.
 *
 * Games and boards come from the catalogue rather than a hand-written list, so
 * a game added tomorrow is searchable tomorrow. Failure to read them degrades
 * to the fixed six rather than throwing: an assistant that can still answer
 * "how is the arcade doing" is worth more than one that errors because the
 * catalogue was briefly unreachable.
 */
export async function listDocuments(): Promise<DocRef[]> {
  const fixed: DocRef[] = FIXED_DOCS.map((doc) => ({
    ...doc,
    keywords: [...doc.keywords],
    url: FIXED_URLS[doc.id] ?? `${SITE_URL}/dashboard`,
  }));

  let games: Awaited<ReturnType<typeof resolveGames>> = [];
  try {
    games = await resolveGames();
  } catch (error) {
    console.error("MCP document catalogue could not read games:", error);
    return fixed;
  }

  const gameDocs: DocRef[] = games.map((game) => ({
    id: `${GAME_DOC_PREFIX}${game.slug}`,
    title: `${game.title} — game report`,
    url: `${SITE_URL}/game/${game.slug}`,
    keywords: [
      game.slug,
      game.title,
      game.category,
      ...game.tags,
      "game", "report", "plays", "reviews", "scores",
    ],
  }));

  return [...fixed, ...gameDocs];
}

/** Render one document, or `null` when the id names nothing. */
export async function getDocument(id: string): Promise<AnalyticsDocument | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(GAME_DOC_PREFIX)) {
    return gameDocument(trimmed.slice(GAME_DOC_PREFIX.length));
  }
  if (trimmed.startsWith(BOARD_DOC_PREFIX)) {
    return boardDocument(trimmed.slice(BOARD_DOC_PREFIX.length));
  }

  switch (trimmed) {
    case "overview":
      return overviewDocument();
    case "growth":
      return growthDocument();
    case "content-health":
      return contentHealthDocument();
    case "alerts":
      return alertsDocument();
    case "metrics":
      return metricsDocument();
    case "schema":
      return schemaDocument();
    default:
      return null;
  }
}

function doc(
  id: string,
  title: string,
  text: string,
  metadata: Record<string, string> = {},
): AnalyticsDocument {
  return {
    id,
    title,
    text,
    url: FIXED_URLS[id] ?? `${SITE_URL}/dashboard`,
    metadata: { source: "hallpass", ...metadata },
  };
}

async function overviewDocument(): Promise<AnalyticsDocument> {
  const [traffic, community] = await Promise.all([
    getDashboardStats(),
    getCommunityStats(),
  ]);

  const trafficLines = !traffic.configured
    ? "Traffic analytics are not configured on this deployment (no PostHog key), so nothing below covers anonymous visitors."
    : traffic.unavailable
      ? `Traffic analytics could not be read: ${traffic.unavailableReason ?? "unknown error"}. This is NOT zero traffic — nothing was measured.`
      : list([
          `Plays: ${withDelta(traffic.playsDelta)}`,
          `Unique visitors: ${withDelta(traffic.visitorsDelta)}`,
          `Searches: ${withDelta(traffic.searchesDelta)}`,
          `Ad clicks: ${n(traffic.adClicks)}`,
          traffic.topGames.length
            ? `Top games by plays: ${traffic.topGames.map((g) => `${g.slug} (${n(g.plays)})`).join(", ")}`
            : null,
          traffic.hourly.length
            ? `Busiest hour (PostHog project time): ${
                traffic.hourly.reduce((best, cur) => (cur.value > best.value ? cur : best)).hour
              }:00`
            : null,
          traffic.weekdays.length
            ? `By weekday: ${traffic.weekdays.map((d) => `${d.label} ${n(d.value)}`).join(", ")}`
            : null,
          traffic.devices.length
            ? `Devices: ${traffic.devices.map((d) => `${d.label} ${n(d.value)}`).join(", ")}`
            : null,
          traffic.countries.length
            ? `Top countries: ${traffic.countries.map((c) => `${c.label} ${n(c.value)}`).join(", ")}`
            : null,
          traffic.zeroResultTerms.length
            ? `Searches that found NOTHING (the next games to add): ${traffic.zeroResultTerms
                .map((t) => `${t.label} (${n(t.value)} people)`)
                .join(", ")}`
            : null,
        ]);

  const communityLines = !community.available
    ? "The first-party database could not be read, so the community numbers are unavailable (not zero)."
    : list([
        `Registered players: ${total(community.players)}.`,
        `New sign-ups in the last ${WINDOW_DAYS} days: ${withDelta(community.playersDelta)}`,
        `Scores submitted: ${total(community.scores)}.`,
        `Scores in the last ${WINDOW_DAYS} days: ${withDelta(community.scoresDelta)}`,
        `Players active in the last 7 days: ${n(community.activePlayers7)}; last 30 days: ${n(community.activePlayers30)}`,
        `Players who came back on a later day than they signed up: ${n(community.returningPlayers)}`,
        `Players who have ever set a score: ${n(community.scoringPlayers)}`,
        `Share of scores attached to a signed-in player: ${share(community.identifiedScores, community.scores) ?? "—"}%`,
        `Leaderboards: ${n(community.boards)} (${n(community.emptyBoards)} have never received a score)`,
        `Player comments: ${total(community.comments)} — ${n(community.recommended)} recommending, ${n(community.flaggedComments)} reported.`,
        `Comments in the last ${WINDOW_DAYS} days: ${withDelta(community.commentsDelta)}`,
        community.topBoards.length
          ? `Busiest boards: ${community.topBoards.map((b) => `${b.title} (${n(b.scores)} scores)`).join(", ")}`
          : null,
      ]);

  return doc(
    "overview",
    "Arcade overview — plays, players, searches, retention",
    list([
      `HallPass arcade, the last ${WINDOW_DAYS} days against the ${WINDOW_DAYS} before.`,
      "",
      "TRAFFIC (PostHog — anonymous devices):",
      trafficLines,
      "",
      "COMMUNITY (first-party database — signed-in people):",
      communityLines,
      "",
      "CAVEAT: the two halves count different things. PostHog counts anonymous devices; " +
        "the community numbers count registered people. Do not divide one by the other. " +
        "'Active' means signed in to the site, not played.",
    ]),
    { windowDays: String(WINDOW_DAYS) },
  );
}

async function growthDocument(): Promise<AnalyticsDocument> {
  const [acquisition, shareLoop] = await Promise.all([getAcquisition(), getShareLoop()]);
  return doc(
    "growth",
    "Growth — where players come from and whether they return",
    list([
      `Acquisition over the last ${WINDOW_DAYS} days (PostHog, counting DEVICES):`,
      JSON.stringify(acquisition, null, 2),
      "",
      "Challenge-link share loop (first-party):",
      JSON.stringify(shareLoop, null, 2),
    ]),
  );
}

async function contentHealthDocument(): Promise<AnalyticsDocument> {
  const health = await getContentHealth();
  const problems = health.games.filter((game) => game.issues.length > 0);
  return doc(
    "content-health",
    "Catalogue health — games missing art, video or description",
    list([
      `${health.healthy} of ${health.total} games have everything they need.`,
      "",
      problems.length
        ? list([
            "Games with something missing:",
            ...problems.map((game) => `- ${game.slug}: ${game.issues.join(", ")}`),
          ])
        : "Every game in the catalogue is complete.",
      "",
      "Cross-reference this against the top games in the overview: a popular game " +
        "with no screenshots is a different problem from an unplayed one with none.",
    ]),
  );
}

async function alertsDocument(): Promise<AnalyticsDocument> {
  const result = await getAlertSnapshot();
  if (!result.ok) {
    return doc(
      "alerts",
      "Alerts — traffic spikes, error spikes and dead games",
      `The alert probe could not measure anything: ${result.reason}\n\n` +
        "This is NOT 'no alerts'. Nothing was measured, so nothing can be concluded " +
        "about whether the site is healthy.",
    );
  }
  const fired = evaluateAlerts(result.snapshot);
  return doc(
    "alerts",
    "Alerts — traffic spikes, error spikes and dead games",
    list([
      fired.length
        ? list(["FIRING NOW:", ...fired.map((alert) => `- ${JSON.stringify(alert)}`)])
        : "Nothing is firing.",
      "",
      "The measurements behind that judgement:",
      JSON.stringify(result.snapshot, null, 2),
      "",
      "Each ratio compares the SAME sixty minutes of the day against the same window " +
        "on previous days, because a site played from school has a daily shape.",
    ]),
  );
}

function metricsDocument(): AnalyticsDocument {
  return doc(
    "metrics",
    "How HallPass counts things — metric definitions",
    list([
      "These definitions are what the dashboard uses. A number computed a different " +
        "way will disagree with it, usually silently.",
      "",
      ...METRIC_DEFINITIONS.map((line, index) => `${index + 1}. ${line}`),
    ]),
  );
}

async function schemaDocument(): Promise<AnalyticsDocument> {
  let views: Awaited<ReturnType<typeof describeAnalyticsViews>> = [];
  try {
    views = await describeAnalyticsViews();
  } catch {
    views = [];
  }
  return doc(
    "schema",
    "Analytics schema — the tables and event catalogue",
    list([
      isAnalyticsDbConfigured()
        ? list([
            "First-party SQL views (query with run_analytics_sql). No view carries an " +
              "email, real name or photo; `player_public_id` is the only player key.",
            ...views.map((v) => `- ${v.view}(${v.columns.map((c) => c.name).join(", ")})`),
          ])
        : "First-party SQL is not available on this deployment (the read-only database " +
          "role is not provisioned).",
      "",
      isStatsConfigured()
        ? list([
            "PostHog events (query with run_analytics_hogql):",
            ...POSTHOG_EVENTS.map((e) => `- ${e.event}: ${e.meaning}`),
          ])
        : "PostHog reading is not configured on this deployment.",
    ]),
  );
}

/**
 * One game's whole picture, assembled across both sources.
 *
 * This is the document that justifies the shape: "how is Duskfall doing" is one
 * question and four queries, and nobody asking it on a phone wants to run them.
 */
async function gameDocument(slug: string): Promise<AnalyticsDocument | null> {
  const games = await resolveGames().catch(() => []);
  const game = games.find((candidate) => candidate.slug === slug);
  if (!game) return null;

  const [traffic, community, health] = await Promise.all([
    getDashboardStats().catch(() => null),
    getCommunityStats().catch(() => null),
    getContentHealth().catch(() => null),
  ]);

  const plays = traffic?.topGames.find((entry) => entry.slug === slug);
  const comments = community?.topCommented.find((entry) => entry.slug === slug);
  const board = community?.topBoards.find((entry) => entry.id.includes(slug));
  const issues = health?.games.find((entry) => entry.slug === slug)?.issues ?? [];

  return {
    id: `${GAME_DOC_PREFIX}${slug}`,
    title: `${game.title} — game report`,
    url: `${SITE_URL}/game/${slug}`,
    metadata: { slug, category: game.category },
    text: list([
      `${game.title} (${slug}) — ${game.category}`,
      game.tagline ? `"${game.tagline}"` : null,
      "",
      plays
        ? `Plays in the last ${WINDOW_DAYS} days: ${n(plays.plays)} (ranked in the site's top games).`
        : `Not in the site's top games for the last ${WINDOW_DAYS} days. That is a ranking, ` +
          "not a zero — use run_analytics_hogql for its exact play count.",
      comments ? `Player comments: ${n(comments.count)}.` : "No player comments among the most-commented games.",
      board ? `Leaderboard: ${n(board.scores)} scores from ${n(board.players)} signed-in players.` : null,
      issues.length
        ? `Catalogue gaps: ${issues.join(", ")}.`
        : "Catalogue entry is complete (art, description, video, reviews).",
      "",
      "For anything more specific — this game's plays by hour, its score " +
        "distribution, who replays it — use run_analytics_hogql with " +
        `properties.game_slug = '${slug}', or run_analytics_sql against the scores ` +
        "and player_plays views.",
    ]),
  };
}

/** A leaderboard's own picture. Ids are board ids, not game slugs. */
async function boardDocument(boardId: string): Promise<AnalyticsDocument | null> {
  const community = await getCommunityStats().catch(() => null);
  const board = community?.topBoards.find((entry) => entry.id === boardId);
  if (!board) return null;
  return {
    id: `${BOARD_DOC_PREFIX}${boardId}`,
    title: `${board.title} — leaderboard`,
    url: `${SITE_URL}/dashboard/boards`,
    metadata: { boardId },
    text: list([
      `${board.title} (${boardId})`,
      `Scores submitted: ${n(board.scores)}`,
      `Distinct signed-in players: ${n(board.players)} (anonymous scores are not counted here)`,
    ]),
  };
}
