/**
 * HallPass — turning a bug-MCP tool call into one line of the dashboard feed.
 *
 * PURE and free of `server-only`, like `config.ts` and `report-view.ts`: no
 * database, no SDK import, no `next/*`. The server-only half that actually
 * writes the row is `activity-log.ts`, and the split is the same one the rest of
 * this folder uses — the part worth unit-testing is the part that decides what
 * the operator READS, and that part must be loadable by Vitest.
 *
 * ── THE SUMMARY IS FOR A HUMAN, NOT FOR A MACHINE ──────────────────────────
 * Nothing reads these strings back. They are rendered on `/dashboard/beta` and
 * that is all they are for, so they are written the way an operator would ask
 * the question: which report, which game, what happened to it. A summary that
 * said `mark_bug_report_fixed({"id":42})` would be a faithful transcript of a
 * call and a useless account of an afternoon.
 *
 * ── REFUSAL IS NOT SUCCESS, AND THIS IS WHERE THAT IS DECIDED ──────────────
 * `bugs.ts` returns `{ ok: false, reason }` rather than throwing when a write's
 * WHERE matched nothing — someone else got there first, or the row is already
 * gone. That distinction survives to the feed: a refused close renders as a
 * refusal, because an operator who reads "closed report 42" for a call that
 * closed nothing has been actively misled by their own dashboard.
 */

/**
 * What happened to a call.
 *  - `ok` — it did what it says.
 *  - `refused` — the tool declined it (already triaged, already gone, wrong
 *    status). Not an error: the agent was told no, in words.
 *  - `failed` — it threw. The agent got an error back.
 */
export const ACTIVITY_OUTCOMES = ["ok", "refused", "failed"] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];

/**
 * The longest line the feed will store, matching the column's CHECK.
 *
 * Small on purpose. The panel is a scannable list of one-liners; a paragraph in
 * it is a paragraph nobody reads, and the agent's own narration is capped by the
 * tool's input schema at the same number so it cannot promise more than the
 * column accepts.
 */
export const SUMMARY_MAX = 300;

/**
 * How many lines the dashboard panel shows, and therefore how big a poll is.
 *
 * Lives here, in the module both halves import, rather than beside the panel:
 * the feed's shape is the MCP's business and the dashboard is one reader of it.
 * Twenty is about a screen of one-liners — enough to see the shape of a session
 * without the panel becoming the page.
 */
export const AGENT_FEED_LIMIT = 20;

/** One row to write, before an actor and a timestamp are attached. */
export type ActivityLine = {
  tool: string;
  outcome: ActivityOutcome;
  reportId: number | null;
  slug: string | null;
  summary: string;
};

/** Collapse whitespace and clip to the column's limit. */
export function toSummary(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX - 1)}…` : flat;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** A short, human phrase for the filters a list call narrowed by. */
function describeFilters(args: Record<string, unknown>): string {
  const parts = [
    readString(args.status),
    readString(args.kind),
    readString(args.severity),
    readString(args.slug),
  ].filter((part): part is string => part != null);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/**
 * Describe a call that completed — whether the tool agreed to it or not.
 *
 * Branches on the SHAPE of the result rather than on a table of tool names, so a
 * sixth tool that returns the same `{ ok, message }` shape as the three writers
 * is described correctly on the day it is added rather than falling through to a
 * bare tool name. The two readers are named because their results are the shapes
 * that carry a report in them.
 */
export function describeToolCall(call: {
  tool: string;
  args: unknown;
  result: unknown;
}): ActivityLine {
  const args = readRecord(call.args);
  const result = readRecord(call.result);
  const reportId = readNumber(args.id) ?? readNumber(args.reportId);
  const slug = readString(args.slug);

  // The three writers, plus anything later that answers in their shape.
  if (typeof result.ok === "boolean") {
    const refused = result.ok === false;
    return {
      tool: call.tool,
      outcome: refused ? "refused" : "ok",
      reportId,
      slug,
      summary: toSummary(
        readString(result.message) ??
          readString(result.reason) ??
          `${call.tool} on report ${reportId ?? "?"}`,
      ),
    };
  }

  if (call.tool === "get_bug_report") {
    // `null` here is not an error: the report is gone, usually because it was
    // fixed. Recorded as `ok` — the tool answered the question it was asked.
    const title = readString(result.title);
    return {
      tool: call.tool,
      outcome: "ok",
      reportId,
      slug: readString(result.slug) ?? slug,
      summary: toSummary(
        title
          ? `Read report ${reportId ?? "?"} — “${title}”`
          : `Looked up report ${reportId ?? "?"}, which no longer exists`,
      ),
    };
  }

  if (call.tool === "list_bug_reports") {
    const reports = Array.isArray(result.reports) ? result.reports : [];
    return {
      tool: call.tool,
      outcome: "ok",
      reportId: null,
      slug,
      summary: toSummary(
        `Listed ${reports.length} report${reports.length === 1 ? "" : "s"}${describeFilters(args)}`,
      ),
    };
  }

  // The narration tool and anything else: the agent's own words if it gave any.
  return {
    tool: call.tool,
    outcome: "ok",
    reportId,
    slug,
    summary: toSummary(readString(args.summary) ?? call.tool),
  };
}

/**
 * Describe a call that THREW.
 *
 * Recorded rather than swallowed, and this is the case most worth having: a
 * crash the operator cannot see is the worst outcome for a surface whose whole
 * purpose is visibility. The wrapper rethrows afterwards, so the agent still
 * gets its error.
 */
export function describeToolFailure(call: {
  tool: string;
  args: unknown;
  error: unknown;
}): ActivityLine {
  const args = readRecord(call.args);
  const message =
    call.error instanceof Error ? call.error.message : String(call.error ?? "unknown error");
  return {
    tool: call.tool,
    outcome: "failed",
    reportId: readNumber(args.id) ?? readNumber(args.reportId),
    slug: readString(args.slug),
    summary: toSummary(`${call.tool} failed: ${message}`),
  };
}
