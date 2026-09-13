/**
 * HallPass — turning an MCP tool call into one line of the dashboard feed.
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
 * ── TWO SUBJECTS, AND THE ARGUMENT NAME DECIDES WHICH ──────────────────────
 * A line can be about a bug report or about a tracker item. Which one is read
 * off the ARGUMENT NAME: `id`/`reportId` is a report, `itemId` is a tracker
 * item. That is why every tracker tool names its argument `itemId` while every
 * bug tool names its `id` (`tracker-mcp-design.md` §3) — an agent working both
 * queues in one session is one confident mistake away from closing report 12
 * when it meant to move item 12, and a feed that recorded the wrong subject
 * would not be the thing that told anybody.
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
  /**
   * The tracker item this is about, when it is about one.
   *
   * Separate from {@link ActivityLine.reportId} rather than one "subject"
   * field, because the two numbering spaces are unrelated and the dashboard
   * reads them differently: a report id is a bug and an item id is a lane on
   * the board. A line may carry both — "fixing report 42, which is tracker item
   * 7" — which is exactly why they are not one column (migration 033).
   */
  itemId: number | null;
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

/** The same, for the filters a tracker list call narrowed by. */
function describeTrackerFilters(args: Record<string, unknown>): string {
  const parts = [readString(args.status), readString(args.tag)].filter(
    (part): part is string => part != null,
  );
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/**
 * Describe a call that completed — whether the tool agreed to it or not.
 *
 * Branches on the SHAPE of the result rather than on a table of tool names, so a
 * tool that returns the same `{ ok, message }` shape as the six writers is
 * described correctly on the day it is added rather than falling through to a
 * bare tool name. The four readers are named because their results are the
 * shapes that carry their subject INSIDE them rather than in a message.
 */
export function describeToolCall(call: {
  tool: string;
  args: unknown;
  result: unknown;
}): ActivityLine {
  const args = readRecord(call.args);
  const result = readRecord(call.result);
  const reportId = readNumber(args.id) ?? readNumber(args.reportId);
  const itemId = readNumber(args.itemId);
  const slug = readString(args.slug);

  // The writers — three for bugs, three for the tracker — plus anything later
  // that answers in their shape.
  if (typeof result.ok === "boolean") {
    const refused = result.ok === false;
    return {
      tool: call.tool,
      outcome: refused ? "refused" : "ok",
      reportId,
      itemId: itemId ?? readNumber(result.itemId),
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
      itemId,
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
      itemId: null,
      slug,
      summary: toSummary(
        `Listed ${reports.length} report${reports.length === 1 ? "" : "s"}${describeFilters(args)}`,
      ),
    };
  }

  if (call.tool === "get_tracker_item") {
    // Named for the same reason the two bug readers are: their results are the
    // shapes that carry their subject inside them rather than in an `ok`.
    const title = readString(result.title);
    return {
      tool: call.tool,
      outcome: "ok",
      reportId: null,
      itemId,
      slug,
      summary: toSummary(
        title
          ? `Read tracker item ${itemId ?? "?"} — “${title}”`
          : `Looked up tracker item ${itemId ?? "?"}, which does not exist`,
      ),
    };
  }

  if (call.tool === "list_tracker_items") {
    const items = Array.isArray(result.items) ? result.items : [];
    return {
      tool: call.tool,
      outcome: "ok",
      reportId: null,
      // A list is about the board, not about an item, so it marks nothing
      // green — which is the point of the marker being per item.
      itemId: null,
      slug,
      summary: toSummary(
        `Listed ${items.length} tracker item${items.length === 1 ? "" : "s"}${describeTrackerFilters(args)}`,
      ),
    };
  }

  // The narration tool and anything else: the agent's own words if it gave any.
  return {
    tool: call.tool,
    outcome: "ok",
    reportId,
    itemId,
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
    itemId: readNumber(args.itemId),
    slug: readString(args.slug),
    summary: toSummary(`${call.tool} failed: ${message}`),
  };
}
