/**
 * HallPass — the MCP's tool surface.
 *
 * SERVER-ONLY, because every tool body reaches `bugs.ts` or `tracker.ts` and
 * therefore the live database. `config.ts` and `report-view.ts` hold the parts worth unit-testing;
 * this module is wiring, and its correctness is mostly a question of whether the
 * descriptions tell an agent the truth.
 *
 * ── THE DESCRIPTIONS ARE THE INTERFACE ─────────────────────────────────────
 * Worth saying plainly, because it is the thing most easily treated as
 * decoration. The caller here is a language model choosing tools from their
 * text: a wrong description does not fail a type check or a test, it produces an
 * agent that closes the wrong bug and is confident about it. So each one below
 * states what the tool does to the DATABASE, in the imperative, and the ones
 * that cannot be undone say so in the first sentence rather than the last.
 *
 * ── ANNOTATIONS ARE HOW A CLIENT KNOWS TO ASK ──────────────────────────────
 * `readOnlyHint` and `destructiveHint` are the MCP-native way to say "this one
 * needs a human's confirmation", and Claude Code reads them. Getting them wrong
 * is worse than omitting them: the SDK's own schema documents `destructiveHint`
 * as defaulting to TRUE for a non-read-only tool, so a writer that is merely
 * additive must say so, and a reader must set `readOnlyHint` or it will be
 * treated as capable of destruction.
 *
 * `openWorldHint: false` on every tool: this server's whole domain is one
 * table's rows. Nothing here reaches an unbounded outside world.
 *
 * ── A NEW SERVER PER REQUEST ───────────────────────────────────────────────
 * `createBugMcpServer()` builds one rather than exporting a singleton. The
 * transport is stateless and this runs on Vercel, where nothing survives between
 * invocations; a module-level server shared across concurrent requests in the
 * same warm instance would be a single object with several transports attached.
 *
 * ── EVERY TOOL IS LOGGED, BY THE WRAPPER AND NOT BY THE TOOL ───────────────
 * {@link logged} records what each call did to the activity feed the beta
 * dashboard renders (`agent-activity-design.md`). It lives HERE, wrapped around
 * the handlers, rather than inside `bugs.ts`: that module's stated virtue is
 * that it adds no SQL and no arithmetic of its own, and a cross-cutting concern
 * threaded through its five functions would also be a concern the sixth one
 * added later quietly forgets. `tracker.ts` was that sixth thing, and it
 * inherited the trail without a line of its own. The one exception is a
 * SUCCESSFUL `finish_agent_activity`, which clears the feed; see
 * {@link logged}.
 */

import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BUG_SEVERITIES, REPORT_KINDS, REPORT_STATUSES } from "@/app/lib/beta/config";
import {
  STATUS_HINT,
  STATUS_LABEL,
  TAG_PATTERN,
  TITLE_MAX,
  TRACKER_STATUSES,
  UPDATE_BODY_MAX,
} from "@/app/lib/tracker/config";
import type { McpActor } from "./actor";
import { registerAnalyticsTools } from "./analytics/tools";
import { SUMMARY_MAX, describeToolCall, describeToolFailure } from "./activity";
import { clearActivity, recordActivity } from "./activity-log";
import {
  closeBugReportDuplicate,
  getBugReport,
  listBugReports,
  markBugReportFixed,
  triageBugReport,
} from "./bugs";
import {
  commentOnTrackerItem,
  createTrackerItem,
  getTrackerItem,
  listTrackerItems,
  moveTrackerItem,
} from "./tracker";
import {
  ACTIVITY_IDLE_MINUTES,
  DEFAULT_REPORT_LIMIT,
  DEFAULT_TRACKER_LIMIT,
  MAX_REPORT_LIMIT,
  MAX_TRACKER_LIMIT,
  MCP_ANALYTICS_SERVER_NAME,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from "./config";

/**
 * Enums built FROM the beta vocabulary rather than written out again.
 *
 * The values a tool advertises and the values the CHECK constraints accept must
 * agree, and the way to guarantee that is to have one source. A severity added
 * to `beta/config.ts` becomes accepted here with no edit; a hand-written list
 * would drift silently and fail at the database, on a call the schema had
 * already told the agent was valid.
 */
const severityEnum = z.enum(BUG_SEVERITIES);
const statusEnum = z.enum(REPORT_STATUSES);
const kindEnum = z.enum(REPORT_KINDS);

/** A positive report id, refused before it can reach a query. */
const reportId = z
  .number()
  .int()
  .positive()
  .describe("The report's numeric id, as returned by list_bug_reports.");

/**
 * The severity override the two judging tools accept.
 *
 * Described rather than merely typed, because the RULE is not guessable from the
 * type: an override wins over the tester's own guess (triage is exactly when a
 * reporter who called their own find a blocker gets corrected), and it is
 * ignored entirely on a feature request, whose severity must stay null.
 */
const severityOverride = severityEnum
  .optional()
  .describe(
    "Optional. Overrides the severity the tester chose, which is what the XP " +
      "award is priced from. Ignored for feature requests, which never carry a " +
      "severity. Omit to keep the tester's own value.",
  );

/**
 * The tracker's own vocabulary, built from `tracker/config.ts` for exactly the
 * reason the beta enums above are built from `beta/config.ts`: a lane added
 * there must not need an edit here, and a hand-written list would fail at the
 * `tracker_items_status_check` CHECK on a call this schema had already accepted.
 */
const trackerStatusEnum = z.enum(TRACKER_STATUSES);

/**
 * A positive tracker item id.
 *
 * NAMED `itemId`, NEVER `id`, and that is load-bearing rather than tidy. The
 * activity feed reads the subject of a line off the argument name — `id` is a
 * bug report, `itemId` is a tracker item (`activity.ts`) — so a tracker tool
 * that called this `id` would file its lines against a bug report with the same
 * number, and the board's green marker would never light at all.
 */
const trackerItemId = z
  .number()
  .int()
  .positive()
  .describe("The tracker item's numeric id, as returned by list_tracker_items.");

/** JSON in a text block — what every tool here answers with. */
function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Run a tool body, record what it did, and answer with it.
 *
 * `args` is passed EXPLICITLY rather than recovered from the handler, so each
 * call site stays inside the SDK's own type inference — the arguments a tool
 * declares are destructured by its handler as before, and this sees the same
 * values by name. The alternative (a generic wrapper around the whole callback)
 * costs the typed destructuring on every tool to save five short object
 * literals.
 *
 * A THROWN body is recorded and then RETHROWN. The SDK turns the throw into a
 * tool error for the agent, which is what an agent needs; the feed gets the line
 * regardless, because a crash the operator cannot see is the worst outcome for a
 * surface built for visibility.
 *
 * `render` is for the one tool whose wire answer differs from the value worth
 * describing: `get_bug_report` describes a missing report as "no longer exists"
 * while answering the agent with an explanation it can act on.
 *
 * `recordSuccess: false` is for the one tool whose success is the feed being
 * EMPTY. `finish_agent_activity` deletes every line, and a line recording that
 * it had would reopen the panel it had just closed (`agent-activity-design.md`
 * §11). Its failure is still recorded above, like every other tool's: a finish
 * that cleared nothing must stay on the panel, with its error.
 */
async function logged<T>(
  tool: string,
  args: Record<string, unknown>,
  run: () => Promise<T>,
  {
    render = (value: T): unknown => value,
    recordSuccess = true,
  }: {
    render?: (value: T) => unknown;
    recordSuccess?: boolean;
  } = {},
) {
  let result: T;
  try {
    result = await run();
  } catch (error) {
    await recordActivity(describeToolFailure({ tool, args, error }));
    throw error;
  }
  if (recordSuccess) await recordActivity(describeToolCall({ tool, args, result }));
  return json(render(result));
}

/** What a client is told this server is, and how to work it, per credential. */
const BUG_INSTRUCTIONS =
  "Bug reports filed by HallPass playtesters against individual games. " +
  "Start with list_bug_reports (status \"open\" is the triage queue), then " +
  "get_bug_report for the full body, the device and the game's own " +
  "JavaScript errors before attempting a fix. Reports are per-game: the " +
  "`slug` field names the game, whose code lives in public/games/<slug>/. " +
  "Closing a report as fixed or duplicate DELETES it and pays the tester " +
  "XP, so do it only after the fix is actually made. Call " +
  "log_agent_activity whenever you start or finish a piece of work: the " +
  "site operator watches a live feed of it on their dashboard, and every " +
  "other tool here only tells them WHAT you did, never why. When ALL of " +
  "your work is done, call finish_agent_activity once: it clears that " +
  "feed, which is how the operator knows nothing is running any more.";

/**
 * The tracker half of what a secret-holder is told.
 *
 * Its own constant rather than more sentences on {@link BUG_INSTRUCTIONS},
 * because it is a different board with a different job and the two are already
 * the thing most worth keeping apart. The rules it states — move it when it is
 * true, comment for next week, narrate for right now — are the ones nothing
 * else can enforce: `agent-activity-design.md` §2 makes the point that a tool
 * whose entire value is that it gets called at all lives or dies by this
 * string.
 */
const TRACKER_INSTRUCTIONS =
  "The project tracker is the board where this site's admins paste in what " +
  "they want built. Before you start a piece of work, call list_tracker_items " +
  "and get_tracker_item: the brief is the specification and the comments are " +
  "what earlier sessions found out. When you actually begin, " +
  "move_tracker_item to \"building\" — that is how the operator knows, and it " +
  "puts a live marker on their board for as long as you keep saying something " +
  "about the item. Move it to \"shipped\" only once the change is really live. " +
  "Use comment_on_tracker_item for what somebody reading the item next week " +
  "needs to know, and log_agent_activity for the running commentary: the " +
  "comment is permanent and the feed is deleted when you finish. Pass the " +
  "item's id to log_agent_activity as `itemId` while you are working on it, so " +
  "the marker stays lit.";

const ANALYTICS_INSTRUCTIONS =
  "Read-only analytics for the HallPass arcade, for the signed-in dashboard " +
  "account that approved this connection. Call describe_analytics_schema " +
  "FIRST: it carries the metric definitions this site already settled, and a " +
  "query written without them will disagree with the operator's dashboard for " +
  "reasons neither of you can reconstruct later. get_overview returns exactly " +
  "what that dashboard shows, so it is the cheapest way to sanity-check " +
  "anything you compute. Use run_analytics_sql (first-party: players, scores, " +
  "plays, reviews, challenges) and run_analytics_hogql (PostHog events: " +
  "traffic, funnels, retention) for the questions the fixed panels do not " +
  "answer. Nothing here can write, and no view carries a player's email, real " +
  "name or photo.";

/**
 * Register the five bug tools and the two feed tools.
 *
 * @see `bug-mcp-design.md` §7 for the table this mirrors.
 *
 * Split out of the old `createBugMcpServer` when the endpoint gained a second
 * credential: WHICH tools exist now depends on who is asking
 * (`analytics-mcp-design.md` §3), so building the server and filling it are two
 * decisions rather than one. The tool bodies below are unchanged.
 */
function registerBugTools(server: McpServer): void {
  server.registerTool(
    "list_bug_reports",
    {
      title: "List bug reports",
      description:
        "List playtester bug reports and feature requests, open ones first and " +
        "newest first within that. Returns summaries only — call get_bug_report " +
        "for the body, the device and the error log. Filters combine.",
      inputSchema: {
        status: statusEnum
          .optional()
          .describe('Only this status. Use "open" for the untriaged queue.'),
        kind: kindEnum.optional().describe('"bug" or "feature".'),
        severity: severityEnum.optional().describe("Only bugs at this severity."),
        slug: z
          .string()
          .optional()
          .describe("Only reports against this game slug, e.g. \"neon-snake\"."),
        limit: z
          .number()
          .int()
          .optional()
          .describe(
            `How many to return. Default ${DEFAULT_REPORT_LIMIT}, maximum ${MAX_REPORT_LIMIT}.`,
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, kind, severity, slug, limit }) =>
      logged("list_bug_reports", { status, kind, severity, slug, limit }, () =>
        listBugReports({ status, kind, severity, slug, limit }),
      ),
  );

  server.registerTool(
    "get_bug_report",
    {
      title: "Read one bug report",
      description:
        "Everything filed about one report: the tester's description, the device " +
        "it happened on, the game's own JavaScript errors captured during the " +
        "session, and URLs for the screenshot and replay clip if the tester " +
        "attached them. This is what to read before attempting a fix.",
      inputSchema: { id: reportId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) =>
      logged("get_bug_report", { id }, () => getBugReport(id), {
        render: (report) =>
          report ?? { error: `Report ${id} does not exist. It may already have been closed.` },
      }),
  );

  server.registerTool(
    "triage_bug_report",
    {
      title: "Accept or reject a bug report",
      description:
        "Judge an OPEN report without removing it. \"accepted\" agrees the report " +
        "is real and pays the tester XP priced by severity; \"rejected\" pays " +
        "nothing. Neither deletes the report. Only open reports can be triaged — " +
        "a report that already has an outcome is refused rather than re-paid.",
      inputSchema: {
        id: reportId,
        status: z
          .enum(["accepted", "rejected"])
          .describe("The outcome. Use mark_bug_report_fixed once it is actually fixed."),
        severity: severityOverride,
      },
      // Writes, but only additively: the row survives and the ledger is
      // append-only. Not idempotent — the second call is refused rather than
      // absorbed, because the report is no longer open.
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, status, severity }) =>
      logged("triage_bug_report", { id, status, severity }, () =>
        triageBugReport({ id, status, severity }),
      ),
  );

  server.registerTool(
    "mark_bug_report_fixed",
    {
      title: "Mark a bug report fixed (deletes it)",
      description:
        "PERMANENTLY DELETES the report and pays the tester. Call this only after " +
        "the fix is really made — there is no undo. An open report is paid both " +
        "the severity award and the fix bonus; an already-accepted one is paid " +
        "the bonus only, because it was paid for the find already. A rejected " +
        "report is refused.",
      inputSchema: { id: reportId, severity: severityOverride },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, severity }) =>
      logged("mark_bug_report_fixed", { id, severity }, () =>
        markBugReportFixed({ id, severity }),
      ),
  );

  server.registerTool(
    "close_bug_report_duplicate",
    {
      title: "Close a bug report as a duplicate (deletes it)",
      description:
        "PERMANENTLY DELETES the report and pays the tester a small consolation " +
        "award — not the severity award, which belongs to whoever filed the bug " +
        "first. Only open reports can be closed this way. There is no undo.",
      inputSchema: { id: reportId },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ id }) =>
      logged("close_bug_report_duplicate", { id }, () => closeBugReportDuplicate({ id })),
  );

  server.registerTool(
    "log_agent_activity",
    {
      title: "Say what you are working on",
      description:
        "Tell the site operator what you are doing, in your own words. It " +
        "appears on their beta dashboard next to the bug queue, live. Call this " +
        "when you start investigating something, when you find the cause, and " +
        "when you are about to make a change — one short sentence each time. " +
        "Every other tool records only its own mechanics, so this is the only " +
        "way anything you REASONED about reaches the person running the site. " +
        "If the work is against a tracker item, pass its id as `itemId` every " +
        "time: that is what keeps the live marker lit beside it on the board. " +
        "Writes nothing to any report and pays nobody.",
      inputSchema: {
        summary: z
          .string()
          .min(1)
          .max(SUMMARY_MAX)
          .describe(
            "One sentence, present tense, about the work — e.g. \"reproducing " +
              "the wall-clipping bug in neon-snake; the error log points at the " +
              "sprite pool\". Not a tool name and not a status word.",
          ),
        reportId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("The bug report this is about, if it is about one."),
        itemId: trackerItemId
          .optional()
          .describe(
            "The TRACKER ITEM this is about, if it is about one. Pass it on " +
              "every line while you are working on that item: it is what keeps " +
              "the live marker lit beside the item on the operator's board, and " +
              "the marker goes out when you stop mentioning it. Not the same " +
              "number as reportId — pass both if the line is about both.",
          ),
        slug: z
          .string()
          .optional()
          .describe("The game this is about, if it is about one."),
      },
      // Appends one line to an operator's feed. Nothing is overwritten and no
      // report is touched, so it is not destructive; not idempotent because two
      // identical notes are two real moments in an afternoon, not a double
      // submit to be absorbed.
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ summary, reportId, itemId, slug }) =>
      logged("log_agent_activity", { summary, reportId, itemId, slug }, async () => ({
        // Echoed back rather than answered with a bare "ok": the agent sees
        // exactly what was recorded, including any truncation, and the feed
        // takes its line from the same string.
        ok: true as const,
        message: summary,
      })),
  );

  server.registerTool(
    "finish_agent_activity",
    {
      title: "Say you have finished (clears the feed)",
      description:
        "DELETES every line of the operator's activity feed and hides it from " +
        "their dashboard, which is how they know nothing is running. Call it " +
        "ONCE, when ALL of your work on the bug queue is done — not after each " +
        "report. Any tool you call afterwards starts a fresh feed. Touches no " +
        "report and pays nobody. If you never call it, the feed clears itself " +
        `after ${ACTIVITY_IDLE_MINUTES} minutes without any activity.`,
      // Deletes the feed's lines, which cannot be brought back, so it says so.
      // Idempotent: a second call finds an empty table and leaves it that way.
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    // No `inputSchema`: the SDK advertises an empty object and calls this with
    // no arguments. No wrap-up sentence either — it would be deleted in the
    // moment it was written, so the last log_agent_activity is the wrap-up.
    async () =>
      logged(
        "finish_agent_activity",
        {},
        async () => {
          const cleared = await clearActivity();
          return {
            ok: true as const,
            message:
              `Cleared ${cleared} line${cleared === 1 ? "" : "s"} from the activity ` +
              "feed; the operator's panel is hidden until your next tool call.",
          };
        },
        { recordSuccess: false },
      ),
  );
}

/**
 * Register the five project-tracker tools.
 *
 * @see `tracker-mcp-design.md` §3 for the table this mirrors.
 *
 * A SECOND BOARD, WITH A SECOND VOCABULARY. These sit beside the bug tools for
 * the same credential, and the descriptions have to keep the two apart: a
 * "report" is a bug a child filed against a game, an "item" is a piece of work
 * an admin asked for. The one place that distinction is most likely to be lost
 * is an id, which is why every tool here takes `itemId` — see
 * {@link trackerItemId}.
 *
 * NOTHING HERE DELETES ANYTHING, and the absence is the design. The bug tools
 * carry two destructive closers because a fixed report genuinely has nothing
 * left to do; archiving or deleting a tracker item is a curation decision a
 * human makes on the board, behind a disclosure that names what is lost.
 * `tracker-mcp-design.md` §8.
 */
function registerTrackerTools(server: McpServer): void {
  server.registerTool(
    "list_tracker_items",
    {
      title: "List what is on the project tracker",
      description:
        "The project board: what the site's admins have asked to be built, and " +
        "where each of those things has got to. Read this before starting work " +
        "and before proposing any — it is the record of what is wanted, what is " +
        "already being built and what was declined. Returns summaries only; " +
        "call get_tracker_item for the brief that says what the thing actually " +
        "is. Archived items are not listed.",
      inputSchema: {
        status: trackerStatusEnum
          .optional()
          .describe(
            `Only this lane. ${TRACKER_STATUSES.map(
              (status) => `"${status}" — ${STATUS_HINT[status].toLowerCase()}`,
            ).join("; ")}.`,
          ),
        tag: z
          .string()
          .optional()
          .describe('Only items carrying this tag, e.g. "pwa" or "mobile".'),
        limit: z
          .number()
          .int()
          .optional()
          .describe(
            `How many to return. Default ${DEFAULT_TRACKER_LIMIT}, maximum ${MAX_TRACKER_LIMIT}. ` +
              "The answer's `total` says how many matched, whether or not they all fit.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, tag, limit }) =>
      logged("list_tracker_items", { status, tag, limit }, () =>
        listTrackerItems({ status, tag, limit }),
      ),
  );

  server.registerTool(
    "get_tracker_item",
    {
      title: "Read one tracker item",
      description:
        "Everything about one item: the BRIEF — what an admin pasted in when " +
        "they asked for it, which is the specification — its lane, its tags, " +
        "and the newest comments on it. Read the comments as well as the " +
        "brief: they are where an earlier session recorded what it tried and " +
        "why it did not work.",
      inputSchema: { itemId: trackerItemId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ itemId }) =>
      logged("get_tracker_item", { itemId }, () => getTrackerItem(itemId), {
        render: (item) =>
          item ?? { error: `Tracker item ${itemId} does not exist.` },
      }),
  );

  server.registerTool(
    "move_tracker_item",
    {
      title: "Move a tracker item to another lane",
      description:
        "Change which lane an item sits in. This is the board's answer to " +
        "\"what is being built right now\", and the site operator reads it as a " +
        `statement of fact — so move an item to "building" when you ACTUALLY ` +
        `start work on it, and to "shipped" only once the change is live. ` +
        "While you are in a lane, the item shows a live marker on the " +
        "operator's board for as long as you keep saying something about it. " +
        `Lanes: ${TRACKER_STATUSES.map(
          (status) => `"${status}" (${STATUS_LABEL[status]}) — ${STATUS_HINT[status].toLowerCase()}`,
        ).join("; ")}. Nothing is deleted and a move can be undone by moving it back.`,
      inputSchema: {
        itemId: trackerItemId,
        status: trackerStatusEnum.describe("The lane to move it to."),
      },
      // Writes, and reversible: the row survives, and moving it back restores
      // the previous lane. Idempotent because moving an item to the lane it is
      // already in is a no-op the store handles rather than a second write.
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ itemId, status }) =>
      logged("move_tracker_item", { itemId, status }, () =>
        moveTrackerItem({ itemId, status }),
      ),
  );

  server.registerTool(
    "comment_on_tracker_item",
    {
      title: "Comment on a tracker item",
      description:
        "Post a note on the item, where it stays forever, beside the notes the " +
        "admins write themselves. THIS IS NOT log_agent_activity: that feed is " +
        "a live view of the session you are in and is deleted when you finish, " +
        "while a comment here is read next week by somebody deciding what " +
        "happened. So write what a person needs to KNOW — what you built, what " +
        "you could not, what you found out that changes the ask — and leave the " +
        "running narration to log_agent_activity. One comment when you finish a " +
        "piece of work beats ten while you do it.",
      inputSchema: {
        itemId: trackerItemId,
        body: z
          .string()
          .min(1)
          .max(UPDATE_BODY_MAX)
          .describe(
            "The note, in plain text. Newlines are kept; it is never rendered " +
              "as HTML or markdown.",
          ),
      },
      // Appends a row to a thread. Nothing is overwritten and the item is
      // untouched, so it is additive; not idempotent because two identical
      // notes are two real moments, not a double submit to be absorbed.
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ itemId, body }) =>
      logged("comment_on_tracker_item", { itemId, body }, () =>
        commentOnTrackerItem({ itemId, body }),
      ),
  );

  server.registerTool(
    "create_tracker_item",
    {
      title: "Put a new item on the tracker",
      description:
        "Paste a new piece of work onto the board — follow-up work you found, " +
        "or something worth doing that nobody has asked for yet. It lands in " +
        `the "new" lane, which is where an admin triages it: creating an item ` +
        "is proposing work, not scheduling it. Put the whole of what you know " +
        "in the brief, the way a person pasting a spec would; it is what " +
        "somebody reads to decide.",
      inputSchema: {
        title: z
          .string()
          .min(1)
          .max(TITLE_MAX)
          .describe("One line, what the thing is. Shown on the card."),
        brief: z
          .string()
          .optional()
          .describe(
            "The detail: what is wanted and why, in plain text. Long is fine — " +
              "this is the field somebody pastes a whole spec into.",
          ),
        tags: z
          .array(z.string())
          .optional()
          .describe(
            `Optional labels, lowercase and hyphenated (${TAG_PATTERN.source}), e.g. ` +
              '["pwa", "mobile"]. Anything unusable is dropped rather than ' +
              "failing the call.",
          ),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ title, brief, tags }) =>
      logged("create_tracker_item", { title, brief, tags }, () =>
        createTrackerItem({ title, brief, tags }),
      ),
  );
}

/**
 * Build the server this caller gets.
 *
 * ONE ENDPOINT, TWO CREDENTIALS, TWO TOOL LISTS. A holder of `MCP_SECRET` gets
 * the seven bug tools, the five project-tracker ones, and the analytics ones,
 * which are read-only and cost it nothing. An OAuth caller gets the analytics
 * tools ONLY.
 *
 * The tracker tools are on the secret's side of that line for a second reason
 * beyond the one below: they include moving a lane, which `tracker/config.ts`
 * restricts to `super_admin` because the status is a claim only whoever is
 * building can make truthfully. `mcp/tracker.ts`'s header argues why a machine
 * holding the secret satisfies that and a signed-in reader does not.
 *
 * Withholding the bug tools from a signed-in person looks backwards until you
 * read `bug-mcp-design.md` §3, which skipped `assertNotOwnWork` — the guard
 * that stops somebody triaging a report they filed themselves — with this
 * reasoning: "The MCP actor is a machine holding a secret; it has no
 * `playerId` and cannot be the author of any report." An OAuth actor HAS a
 * `playerId`, so that case stops being impossible and the four-eyes rule in
 * `permissions.ts` comes back into scope. Deciding how a machine-mediated close
 * interacts with it is a feature, not a side effect of adding a credential.
 *
 * The upshot is a sentence that is true rather than aspirational: an OAuth
 * session on this server can read and cannot write.
 *
 * The server also NAMES ITSELF differently per caller, because it genuinely is
 * a different thing to each: a secret-holder still sees `hallpass-bugs`, with
 * the instructions it has always had, and nothing about that path changes.
 */
export function createMcpServer(
  actor: McpActor,
  { declareUi = false }: { declareUi?: boolean } = {},
): McpServer {
  const isSecret = actor.kind === "secret";
  const server = new McpServer(
    {
      name: isSecret ? MCP_SERVER_NAME : MCP_ANALYTICS_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      instructions: isSecret
        ? `${BUG_INSTRUCTIONS}\n\n${TRACKER_INSTRUCTIONS}\n\n${ANALYTICS_INSTRUCTIONS}`
        : ANALYTICS_INSTRUCTIONS,
    },
  );

  if (isSecret) {
    registerBugTools(server);
    registerTrackerTools(server);
  }
  registerAnalyticsTools(server, { declareUi });

  return server;
}
