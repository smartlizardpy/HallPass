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
import { mdHeading, mdList, mdNumber, mdSections, mdStat, mdTable } from "./md";
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
 * windowed change have to be separate sentences — the overview now renders the
 * total with an "all time" note beside it and the change on its own line.
 */
function withDelta(delta: { value: number; prev: number; pct: number | null }): string {
  if (delta.pct === null) {
    return `${n(delta.value)} (no comparable previous period)`;
  }
  const direction = delta.pct >= 0 ? "up" : "down";
  return `${n(delta.value)} (${direction} ${Math.abs(Math.round(delta.pct))}% on the previous ${WINDOW_DAYS} days, from ${n(delta.prev)})`;
}


function list(lines: (string | null | undefined | false)[]): string {
  return mdList(lines);
}

/** A ranked `label — count` table, or null when there is nothing to rank. */
function ranked(headers: [string, string], rows: [string, number][]): string | null {
  if (rows.length === 0) return null;
  return mdTable([headers[0], headers[1]], rows.map(([label, value]) => [label, n(value)]));
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
    ? "_Traffic analytics are not configured on this deployment (no PostHog key), so nothing below covers anonymous visitors._"
    : traffic.unavailable
      ? `_Traffic analytics could not be read: ${traffic.unavailableReason ?? "unknown error"}. This is **not** zero traffic — nothing was measured._`
      : mdSections([
          list([
            mdStat("Plays", withDelta(traffic.playsDelta)),
            mdStat("Unique visitors", withDelta(traffic.visitorsDelta)),
            mdStat("Searches", withDelta(traffic.searchesDelta)),
            mdStat("Ad clicks", mdNumber(traffic.adClicks)),
            traffic.hourly.length
              ? mdStat(
                  "Busiest hour",
                  `**${traffic.hourly.reduce((best, cur) => (cur.value > best.value ? cur : best)).hour}:00**`,
                  "PostHog project time, not UTC and not the player's",
                )
              : null,
          ]),
          ranked(["Top game", "Plays"], traffic.topGames.map((g) => [g.slug, g.plays])),
          ranked(["Weekday", "Plays"], traffic.weekdays.map((d) => [d.label, d.value])),
          ranked(["Device", "Plays"], traffic.devices.map((d) => [d.label, d.value])),
          ranked(["Country", "Visitors"], traffic.countries.map((c) => [c.label, c.value])),
          traffic.zeroResultTerms.length
            ? mdSections([
                "**Searches that found nothing** — the next games to add:",
                mdTable(
                  ["Term", "People"],
                  traffic.zeroResultTerms.map((t) => [t.label, n(t.value)]),
                ),
              ])
            : null,
        ]);

  const communityLines = !community.available
    ? "_The first-party database could not be read, so the community numbers are unavailable (not zero)._"
    : mdSections([
        list([
          mdStat("Registered players", mdNumber(community.players), "all time"),
          mdStat(`New sign-ups`, withDelta(community.playersDelta), `last ${WINDOW_DAYS} days`),
          mdStat("Scores submitted", mdNumber(community.scores), "all time"),
          mdStat("Scores", withDelta(community.scoresDelta), `last ${WINDOW_DAYS} days`),
          mdStat(
            "Active players",
            `${mdNumber(community.activePlayers7)} in 7 days, ${mdNumber(community.activePlayers30)} in 30`,
            "signed in to the site — not played",
          ),
          mdStat(
            "Returning players",
            mdNumber(community.returningPlayers),
            "came back on a later day than they signed up",
          ),
          mdStat("Players who have ever scored", mdNumber(community.scoringPlayers)),
          mdStat(
            "Scores attached to a signed-in player",
            `**${share(community.identifiedScores, community.scores) ?? "—"}%**`,
            "the rest are anonymous handles, which still count on the board",
          ),
          mdStat(
            "Leaderboards",
            mdNumber(community.boards),
            `${n(community.emptyBoards)} have never received a score`,
          ),
          mdStat(
            "Player comments",
            mdNumber(community.comments),
            `${n(community.recommended)} recommending, ${n(community.flaggedComments)} reported`,
          ),
        ]),
        ranked(
          ["Busiest board", "Scores"],
          community.topBoards.map((b) => [b.title, b.scores]),
        ),
      ]);

  return doc(
    "overview",
    "Arcade overview — plays, players, searches, retention",
    mdSections([
      `_HallPass arcade — the last ${WINDOW_DAYS} days against the ${WINDOW_DAYS} before._`,
      mdHeading("Traffic", 3),
      "_PostHog, counting anonymous devices._",
      trafficLines,
      mdHeading("Community", 3),
      "_First-party database, counting signed-in people._",
      communityLines,
      "> **The two halves count different things.** PostHog counts anonymous devices; " +
        "the community numbers count registered people. Do not divide one by the other. " +
        '"Active" means signed in to the site, not played.',
    ]),
    { windowDays: String(WINDOW_DAYS) },
  );
}

async function growthDocument(): Promise<AnalyticsDocument> {
  const [acquisition, shareLoop] = await Promise.all([getAcquisition(), getShareLoop()]);
  const a = acquisition as unknown as Record<string, unknown>;
  const num = (key: string) => (typeof a[key] === "number" ? (a[key] as number) : null);
  const rows = (key: string) => (Array.isArray(a[key]) ? (a[key] as Record<string, unknown>[]) : []);

  /** Turn one of acquisition's `{label-ish, count-ish}` lists into a table. */
  const listTable = (key: string, headers: [string, string]): string | null => {
    const entries = rows(key);
    if (entries.length === 0) return null;
    const [labelKey, valueKey] = Object.keys(entries[0]);
    return mdSections([
      `**${headers[0]}**`,
      mdTable(headers, entries.slice(0, 10).map((row) => [row[labelKey], row[valueKey]])),
    ]);
  };

  return doc(
    "growth",
    "Growth — where players come from and whether they return",
    mdSections([
      `_Acquisition over the last ${WINDOW_DAYS} days. PostHog counts **devices**, not people._`,
      list([
        num("devices") !== null ? mdStat("Devices seen", mdNumber(num("devices")!)) : null,
        num("firstTime") !== null ? mdStat("First-time devices", mdNumber(num("firstTime")!)) : null,
        num("returning") !== null
          ? mdStat("Returning devices", mdNumber(num("returning")!), "the north-star number")
          : null,
        num("returnRate") !== null ? mdStat("Return rate", `**${num("returnRate")}%**`) : null,
      ]),
      listTable("channels", ["Channel", "Devices"]),
      listTable("referrers", ["Referring domain", "Devices"]),
      listTable("entryPages", ["Entry page", "Devices"]),
      mdHeading("Challenge-link share loop", 3),
      "_First-party: real challenge rows, not events._",
      mdTable(
        ["Metric", "Count"],
        Object.entries(shareLoop as unknown as Record<string, unknown>)
          .filter(([, value]) => typeof value === "number")
          .map(([key, value]) => [key, n(value as number)]),
      ) || "_No share-loop activity yet._",
    ]),
  );
}

async function contentHealthDocument(): Promise<AnalyticsDocument> {
  const health = await getContentHealth();
  const problems = health.games.filter((game) => game.issues.length > 0);
  return doc(
    "content-health",
    "Catalogue health — games missing art, video or description",
    mdSections([
      `${mdNumber(health.healthy)} of ${mdNumber(health.total)} games have everything they need.`,
      problems.length
        ? mdTable(
            ["Game", "Missing"],
            problems.map((game) => [game.slug, game.issues.join(", ")]),
          )
        : "Every game in the catalogue is complete.",
      "> Cross-reference this against the top games in the overview: a popular game " +
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
    mdSections([
      fired.length
        ? mdSections([
            `### ⚠️ ${fired.length} alert(s) firing`,
            mdList(fired.map((alert) => `\`${JSON.stringify(alert)}\``)),
          ])
        : "**Nothing is firing.**",
      mdHeading("The measurements behind that judgement", 3),
      mdTable(
        ["Measure", "Value"],
        Object.entries(result.snapshot as unknown as Record<string, unknown>).map(
          ([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : value],
        ),
      ),
      "> Each ratio compares the **same sixty minutes of the day** against the same " +
        "window on previous days, because a site played from school has a daily shape.",
    ]),
  );
}

function metricsDocument(): AnalyticsDocument {
  return doc(
    "metrics",
    "How HallPass counts things — metric definitions",
    mdSections([
      "_These definitions are what the dashboard uses. A number computed a different " +
        "way will disagree with it, usually silently._",
      METRIC_DEFINITIONS.map((line, index) => `${index + 1}. ${line}`).join("\n\n"),
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
    mdSections([
      mdHeading("First-party SQL views", 3),
      isAnalyticsDbConfigured()
        ? mdSections([
            "_Query with `run_analytics_sql`. No view carries an email, real name or " +
              "photo; `player_public_id` is the only player key._",
            mdTable(
              ["View", "Columns"],
              views.map((v) => [v.view, v.columns.map((c) => c.name).join(", ")]),
            ),
          ])
        : "_Not available on this deployment: the read-only database role is not provisioned._",
      mdHeading("PostHog events", 3),
      isStatsConfigured()
        ? mdSections([
            "_Query with `run_analytics_hogql`._",
            mdTable(["Event", "Meaning"], POSTHOG_EVENTS.map((e) => [e.event, e.meaning])),
          ])
        : "_PostHog reading is not configured on this deployment._",
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
    text: mdSections([
      `**${game.title}** (\`${slug}\`) — ${game.category}`,
      game.tagline ? `_${game.tagline}_` : null,
      list([plays
        ? `Plays in the last ${WINDOW_DAYS} days: ${n(plays.plays)} (ranked in the site's top games).`
        : `Not in the site's top games for the last ${WINDOW_DAYS} days — that is a ranking, ` +
          "not a zero. Use `run_analytics_hogql` for its exact play count.",
      comments
        ? mdStat("Player comments", mdNumber(comments.count))
        : "No player comments among the most-commented games.",
      board
        ? mdStat(
            "Leaderboard",
            `${mdNumber(board.scores)} scores from ${mdNumber(board.players)} signed-in players`,
          )
        : null,
      issues.length
        ? mdStat("Catalogue gaps", issues.join(", "))
        : "Catalogue entry is complete — art, description, video and reviews.",
      ]),
      "> For anything more specific — plays by hour, the score distribution, who " +
        `replays it — use \`run_analytics_hogql\` with \`properties.game_slug = '${slug}'\`, ` +
        "or `run_analytics_sql` against the `scores` and `player_plays` views.",
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
    text: mdSections([
      `**${board.title}** (\`${boardId}\`)`,
      mdList([
        mdStat("Scores submitted", mdNumber(board.scores)),
        mdStat(
          "Distinct signed-in players",
          mdNumber(board.players),
          "anonymous scores are not counted here",
        ),
      ]),
    ]),
  };
}
