import "server-only";

/**
 * HallPass — the analytics MCP's tool surface.
 *
 * SERVER-ONLY: every body reaches PostHog or Neon. `sql-guard.ts` and
 * `definitions.ts` hold the parts worth unit-testing; this module is wiring,
 * and its correctness is mostly whether the descriptions tell a model the
 * truth. Same argument as `mcp/server.ts`'s header, and it applies harder here:
 * an agent that misreads a bug tool closes the wrong bug and somebody notices,
 * while an agent that misreads an analytics tool produces a confident wrong
 * number that nobody can trace.
 *
 * ── FOUR CURATED TOOLS THAT ADD NO SQL ────────────────────────────────────
 * `get_overview`, `get_growth`, `get_content_health` and `get_alerts` call the
 * SAME functions the dashboard pages call. Not similar queries — the same
 * functions. So a number read through the MCP and a number read on the screen
 * cannot disagree: if they ever do, one shared function is wrong, which is a
 * bug to fix rather than a discrepancy to reconcile.
 *
 * ── AND THREE THAT LET THE MODEL ASK SOMETHING NOBODY BUILT A PANEL FOR ───
 * That is the whole point of the feature (`analytics-mcp-design.md` §1), and
 * `describe_analytics_schema` is what stops it going wrong: it hands over the
 * metric definitions this codebase already paid for, so the model does not
 * reinvent "a play" as `game_started OR featured_game_opened` and quietly
 * double-count.
 *
 * ── EVERY TOOL IS `readOnlyHint` AND THAT IS A FACT, NOT A HINT ───────────
 * There is no write path here at all: the Postgres connection is a role with no
 * write grants, PostHog is reached with a read key, and the four curated tools
 * call readers. `mcp/server.ts` warns that getting annotations wrong is worse
 * than omitting them; this is the easy direction to get right.
 *
 * ── THESE TOOLS DO NOT WRITE TO THE AGENT ACTIVITY FEED ───────────────────
 * The bug tools do, through `logged()`. This was planned and then dropped on
 * contact: `activity.ts`'s `describeToolCall` is written entirely around bug
 * reports — its fallback summary is "<tool> on report ?" — so an analytics call
 * would land on the operator's triage panel as a line about a report that does
 * not exist. The feed's stated job (`agent-activity-design.md`) is narrating a
 * run through the bug QUEUE, and it is cleared when that run ends.
 *
 * The audit trail for an analytics caller is a different, better one: every
 * request stamps `last_used_at` on its OAuth grant, and `/dashboard/mcp` shows
 * it per connection alongside who approved it.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDashboardStats, hogqlNamed, isStatsConfigured } from "@/app/lib/stats";
import { SITE_URL } from "@/app/lib/site";
import { getCommunityStats, WINDOW_DAYS } from "@/app/lib/overview";
import { getAcquisition } from "@/app/lib/growth/acquisition";
import { getShareLoop } from "@/app/lib/growth/share-loop";
import { getContentHealth } from "@/app/lib/growth/content-health";
import { getAlertSnapshot } from "@/app/lib/alerts/metrics";
import { evaluateAlerts } from "@/app/lib/alerts/rules";
import {
  METRIC_DEFINITIONS,
  POSTHOG_EVENTS,
  POSTHOG_PROPERTIES,
} from "./definitions";
import { MAX_SEARCH_RESULTS, rankDocs } from "./doc-index";
import { getDocument, listDocuments } from "./documents";
import {
  DEFAULT_ROWS,
  MAX_ROWS,
  guardAnalyticsSql,
  guardHogqlQuery,
} from "./sql-guard";
import {
  describeAnalyticsViews,
  isAnalyticsDbConfigured,
  runAnalyticsQuery,
} from "./db";

/** JSON in a text block — the same answer shape the bug tools use. */
function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * The answer shape the HOSTED assistants require: `structuredContent` AND a
 * `content` text block carrying the identical JSON.
 *
 * Both, and identical, is not redundancy — it is the contract. ChatGPT reads
 * `structuredContent` to build citations and reads `content` as what the model
 * actually sees, and a server that sends only one of them either renders no
 * source links or hands the model nothing to read. Deriving the second from the
 * first here is what stops them drifting apart per tool.
 */
function structured(value: unknown) {
  return {
    structuredContent: value as Record<string, unknown>,
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

/** Every tool here reads and nothing here reaches an unbounded outside world. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

/**
 * Turn a thrown error into the tool's ANSWER rather than letting it become a
 * protocol error.
 *
 * Deliberate, and the opposite of what `mcp/bugs.ts` does. A bug tool that
 * cannot reach the database must fail loudly, because an agent told "no bugs"
 * would go and do something else. An analytics query that fails has usually
 * failed for a reason the MODEL can fix — "column x does not exist", "syntax
 * error near y" — and handing that text back is what lets it write the next
 * query correctly instead of giving up.
 */
function failure(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}

const rowLimit = z
  .number()
  .int()
  .optional()
  .describe(
    `Maximum rows to return. Defaults to ${DEFAULT_ROWS}, capped at ${MAX_ROWS}. ` +
      "Out-of-range values are clamped, not refused.",
  );

/**
 * Register the analytics tools on a server.
 *
 * `run_analytics_sql` is registered ONLY when the reader connection exists.
 * A tool a model can see but that always fails is worse than one that is
 * absent: it will keep trying, and its explanation of why the data is missing
 * will be wrong. `describe_analytics_schema` says so in words instead.
 */
export function registerAnalyticsTools(server: McpServer): void {
  // ── `search` and `fetch`: the hosted-assistant contract ──────────────────
  //
  // Registered FIRST because they are the two tools ChatGPT's connector looks
  // for by name, and because they are the right first tools for a person on a
  // phone: name a report, read it, ask a follow-up. The other five remain for
  // the questions that need a query rather than a document.
  //
  // Their answer shape is fixed by that contract (see `structured` above), which
  // is why these two do not use `json()` like everything else here.
  server.registerTool(
    "search",
    {
      title: "Search HallPass analytics",
      description:
        "Find HallPass analytics reports by name or subject. Returns a list of " +
        "documents with an id, a title and a citable URL — pass an id to `fetch` " +
        "to read one. Covers the arcade overview, growth and acquisition, " +
        "catalogue health, live alerts, the metric definitions, the data schema, " +
        "and a per-game report for every game on the site. Try a game's name, or " +
        "a subject like \"retention\", \"where do players come from\" or \"is " +
        "anything broken\".",
      inputSchema: {
        query: z.string().describe("What to look for. A game name, or a subject."),
      },
      annotations: READ_ONLY,
    },
    async ({ query }) => {
      try {
        const docs = await listDocuments();
        const hits = rankDocs(docs, query ?? "", MAX_SEARCH_RESULTS);
        return structured({
          results: hits.map((hit) => ({ id: hit.id, title: hit.title, url: hit.url })),
        });
      } catch (error) {
        // An empty result list, not a thrown error: a hosted assistant renders a
        // tool failure as "the connector is broken", which is a worse and less
        // actionable answer than "nothing matched" plus the reason.
        return structured({ results: [], error: failure(error).error });
      }
    },
  );

  server.registerTool(
    "fetch",
    {
      title: "Read a HallPass analytics report",
      description:
        "Read one analytics report in full, by the id `search` returned. Reports " +
        "are written to be read: the numbers with their comparisons and the " +
        "caveats that apply to them, not raw rows. Ids are `overview`, `growth`, " +
        "`content-health`, `alerts`, `metrics`, `schema`, or `game:<slug>` for a " +
        "single game.",
      inputSchema: {
        id: z.string().describe("A document id from `search`, e.g. `overview` or `game:duskfall`."),
      },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      try {
        const document = await getDocument(id);
        if (!document) {
          return structured({
            id,
            title: "Not found",
            text:
              `There is no HallPass analytics report with the id "${id}". Call ` +
              "`search` to list the reports that exist.",
            url: `${SITE_URL}/dashboard`,
          });
        }
        return structured(document);
      } catch (error) {
        return structured({
          id,
          title: "Unavailable",
          text: `That report could not be built: ${failure(error).error}`,
          url: `${SITE_URL}/dashboard`,
        });
      }
    },
  );

  server.registerTool(
    "get_overview",
    {
      title: "Arcade overview",
      description:
        "The numbers on the HallPass dashboard overview, both halves of it: the " +
        `PostHog traffic picture (plays, unique visitors, searches, top games, ` +
        `hour-of-day, weekday, categories, devices, countries, searches that ` +
        `found nothing) and the first-party Neon community picture (players, ` +
        `boards, scores, comments, active and returning players, busiest ` +
        `boards). Both are a ${WINDOW_DAYS}-day window against the ${WINDOW_DAYS} ` +
        "days before it. Start here: it is one call, it is what the operator is " +
        "looking at, and it costs nothing to compare a query against. Read " +
        "describe_analytics_schema before recomputing any of it yourself.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const [traffic, community] = await Promise.all([
          getDashboardStats(),
          getCommunityStats(),
        ]);
        return json({ windowDays: WINDOW_DAYS, traffic, community });
      } catch (error) {
        return json(failure(error));
      }
    },
  );

  server.registerTool(
    "get_growth",
    {
      title: "Acquisition and the share loop",
      description:
        "Where players come from and whether they come back: devices, first-time " +
        "vs returning devices, return rate, the acquisition channel mix from the " +
        "?ref= first-touch property, referring domains, entry pages, a daily " +
        "first-vs-returning series, and the challenge-link share loop (links " +
        "made, opened, claimed). The acquisition half is PostHog and counts " +
        "DEVICES; the share loop is Neon and counts real challenge rows.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const [acquisition, shareLoop] = await Promise.all([
          getAcquisition(),
          getShareLoop(),
        ]);
        return json({ acquisition, shareLoop });
      } catch (error) {
        return json(failure(error));
      }
    },
  );

  server.registerTool(
    "get_content_health",
    {
      title: "Catalogue health",
      description:
        "Every game in the catalogue and what it is missing — cover art, " +
        "screenshots, a trailer, a description, reviews. The answer to 'what " +
        "should I work on in the catalogue', and the thing to cross-reference " +
        "against top games: a popular game with no screenshots is a different " +
        "problem from an unpopular one with none.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        return json(await getContentHealth());
      } catch (error) {
        return json(failure(error));
      }
    },
  );

  server.registerTool(
    "get_alerts",
    {
      title: "Live alerts",
      description:
        "What the half-hourly site-alert probe currently measures and which " +
        "rules it fires: a traffic spike or collapse against the SAME window on " +
        "previous days, an error spike from captured exceptions, and games with " +
        "no plays. Reports failure explicitly rather than answering zero — a " +
        "silent 'nothing wrong' from a broken probe is indistinguishable from a " +
        "healthy site.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const result = await getAlertSnapshot();
        if (!result.ok) {
          return json({
            available: false,
            reason: result.reason,
            note:
              "The alert probe could not read PostHog. This is NOT 'no alerts' — " +
              "nothing was measured.",
          });
        }
        return json({
          available: true,
          snapshot: result.snapshot,
          fired: evaluateAlerts(result.snapshot),
        });
      } catch (error) {
        return json(failure(error));
      }
    },
  );

  server.registerTool(
    "describe_analytics_schema",
    {
      title: "Schema and metric definitions",
      description:
        "READ THIS BEFORE WRITING A QUERY. Three things: every view in the `mcp` " +
        "Postgres schema with its columns, the PostHog event and property " +
        "catalogue, and — most importantly — the METRIC DEFINITIONS this site " +
        "already settled. Those are not style notes: 'a play' means one specific " +
        "event and counting the obvious second one double-counts; 'active' means " +
        "signed in, not played; the two data sources count devices and people " +
        "respectively and must not be divided by each other.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      let views: Awaited<ReturnType<typeof describeAnalyticsViews>> = [];
      let viewsError: string | null = null;
      try {
        views = await describeAnalyticsViews();
      } catch (error) {
        viewsError = failure(error).error;
      }

      return json({
        metricDefinitions: METRIC_DEFINITIONS,
        postgres: {
          available: isAnalyticsDbConfigured(),
          note: isAnalyticsDbConfigured()
            ? "Query these with run_analytics_sql. The connection is a read-only " +
              "role with no access to the underlying tables, so every personal " +
              "column is absent by construction — there is no email, real name or " +
              "photo anywhere, and `player_public_id` is the only player key. " +
              "Unqualified names resolve to this schema."
            : "run_analytics_sql is NOT AVAILABLE on this deployment: " +
              "MCP_ANALYTICS_DATABASE_URL is unset, so the read-only role has not " +
              "been provisioned. This is a configuration gap, not an absence of " +
              "data. The curated tools above still work.",
          schema: "mcp",
          views,
          viewsError,
        },
        posthog: {
          available: isStatsConfigured(),
          note: isStatsConfigured()
            ? "Query these with run_analytics_hogql. HogQL is ClickHouse-flavoured " +
              "SQL over a single `events` table; properties are addressed as " +
              "`properties.name`. Retention is roughly 30 days on this plan."
            : "run_analytics_hogql will return nothing: POSTHOG_PERSONAL_API_KEY " +
              "is unset on this deployment.",
          events: POSTHOG_EVENTS,
          properties: POSTHOG_PROPERTIES,
        },
      });
    },
  );

  server.registerTool(
    "run_analytics_hogql",
    {
      title: "Query PostHog events",
      description:
        "Run one read-only HogQL query against PostHog's `events` table — " +
        "funnels, cohorts, retention curves, correlations, anything the fixed " +
        "panels do not answer. ClickHouse-flavoured SQL: `countIf`, `toHour`, " +
        "`toDayOfWeek` (ISO, Monday = 1), `arrayJoin`, and properties as " +
        "`properties.game_slug`. One statement, starting SELECT or WITH. Results " +
        "are capped; a `truncated` flag says when the answer is partial. Call " +
        "describe_analytics_schema first for the event catalogue and for what " +
        "counts as a play.",
      inputSchema: {
        query: z.string().describe("One read-only HogQL SELECT."),
        limit: rowLimit,
      },
      annotations: READ_ONLY,
    },
    async ({ query, limit }) => {
      const guarded = guardHogqlQuery(query, limit);
      if (!guarded.ok) return json({ error: guarded.reason });
      if (!isStatsConfigured()) {
        return json({
          error:
            "PostHog reading is not configured on this deployment " +
            "(POSTHOG_PERSONAL_API_KEY is unset). No events could be read; this is " +
            "not the same as there being no events.",
        });
      }
      try {
        const rows = await hogqlNamed<Record<string, unknown>>(guarded.sql, "mcp-analytics");
        return json({
          rows,
          rowCount: rows.length,
          truncated: rows.length >= guarded.limit,
          limit: guarded.limit,
        });
      } catch (error) {
        return json(failure(error));
      }
    },
  );

  if (!isAnalyticsDbConfigured()) return;

  server.registerTool(
    "run_analytics_sql",
    {
      title: "Query the analytics database",
      description:
        "Run one read-only SELECT against the `mcp` schema — the first-party " +
        "picture: players, scores, boards, plays, reviews, friendships, " +
        "achievements, challenges, beta reports and the catalogue. This is where " +
        "cross-table questions live ('do players who leave a review score higher " +
        "afterwards?'). The connection is a role with no privileges on the " +
        "underlying tables, so personal columns are absent by construction and a " +
        "write is refused by Postgres. One statement, starting SELECT or WITH; " +
        "results are capped and flagged when truncated. Call " +
        "describe_analytics_schema first for the views and the metric definitions.",
      inputSchema: {
        query: z.string().describe("One read-only SQL SELECT over the `mcp` schema."),
        limit: rowLimit,
      },
      annotations: READ_ONLY,
    },
    async ({ query, limit }) => {
      const guarded = guardAnalyticsSql(query, limit);
      if (!guarded.ok) return json({ error: guarded.reason });
      try {
        const { rows, truncated } = await runAnalyticsQuery(guarded.sql, guarded.limit);
        return json({ rows, rowCount: rows.length, truncated, limit: guarded.limit });
      } catch (error) {
        return json(failure(error));
      }
    },
  );
}
