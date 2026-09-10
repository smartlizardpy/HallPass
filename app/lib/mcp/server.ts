/**
 * HallPass — the bug MCP's tool surface.
 *
 * SERVER-ONLY, because every tool body reaches `bugs.ts` and therefore the live
 * database. `config.ts` and `report-view.ts` hold the parts worth unit-testing;
 * this module is wiring, and its correctness is mostly a question of whether the
 * descriptions tell an agent the truth.
 *
 * ── THE DESCRIPTIONS ARE THE INTERFACE ─────────────────────────────────────
 * Worth saying plainly, because it is the thing most easily treated as
 * decoration. The caller here is a language model choosing tools from their
 * text: a wrong description does not fail a type check or a test, it produces an
 * agent that closes the wrong bug and is confident about it. So each one below
 * states what the tool does to the DATABASE, in the imperative, and the three
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
 */

import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BUG_SEVERITIES, REPORT_KINDS, REPORT_STATUSES } from "@/app/lib/beta/config";
import {
  closeBugReportDuplicate,
  getBugReport,
  listBugReports,
  markBugReportFixed,
  triageBugReport,
} from "./bugs";
import { DEFAULT_REPORT_LIMIT, MAX_REPORT_LIMIT, MCP_SERVER_NAME, MCP_SERVER_VERSION } from "./config";

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

/** JSON in a text block — what every tool here answers with. */
function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Build a server with the five bug tools registered.
 *
 * @see `bug-mcp-design.md` §7 for the table this mirrors.
 */
export function createBugMcpServer(): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions:
        "Bug reports filed by HallPass playtesters against individual games. " +
        "Start with list_bug_reports (status \"open\" is the triage queue), then " +
        "get_bug_report for the full body, the device and the game's own " +
        "JavaScript errors before attempting a fix. Reports are per-game: the " +
        "`slug` field names the game, whose code lives in public/games/<slug>/. " +
        "Closing a report as fixed or duplicate DELETES it and pays the tester " +
        "XP, so do it only after the fix is actually made.",
    },
  );

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
      json(await listBugReports({ status, kind, severity, slug, limit })),
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
    async ({ id }) => {
      const report = await getBugReport(id);
      return report
        ? json(report)
        : json({ error: `Report ${id} does not exist. It may already have been closed.` });
    },
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
    async ({ id, status, severity }) => json(await triageBugReport({ id, status, severity })),
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
    async ({ id, severity }) => json(await markBugReportFixed({ id, severity })),
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
    async ({ id }) => json(await closeBugReportDuplicate({ id })),
  );

  return server;
}
