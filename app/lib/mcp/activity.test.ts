/**
 * Tests for the tool-call → feed-line mapping.
 *
 * The property that matters is that the feed cannot LIE in the direction that
 * costs something. A refused write rendering as a success would tell an operator
 * a bug was closed when the row is still sitting in the queue, and a thrown call
 * rendering as nothing at all would hide the only evidence that an agent is
 * stuck. Both are asserted here rather than left to review.
 *
 * Free of `server-only` on both sides, which is why this file can exist:
 * `activity.ts` is pure and `activity-log.ts` is the half that reaches the
 * database.
 */

import { describe, expect, it } from "vitest";
import { SUMMARY_MAX, describeToolCall, describeToolFailure, toSummary } from "./activity";

describe("describeToolCall", () => {
  it("records a refused write as refused, never as ok", () => {
    const line = describeToolCall({
      tool: "mark_bug_report_fixed",
      args: { id: 42 },
      result: { ok: false, reason: "Someone else resolved report 42 first." },
    });
    expect(line.outcome).toBe("refused");
    expect(line.summary).toBe("Someone else resolved report 42 first.");
    expect(line.reportId).toBe(42);
  });

  it("carries the write's own message through on success", () => {
    const line = describeToolCall({
      tool: "triage_bug_report",
      args: { id: 7, status: "accepted" },
      result: { ok: true, message: "Report 7 accepted as major — 75 XP awarded." },
    });
    expect(line).toMatchObject({
      outcome: "ok",
      reportId: 7,
      summary: "Report 7 accepted as major — 75 XP awarded.",
    });
  });

  it("describes a read by the report's title and game", () => {
    const line = describeToolCall({
      tool: "get_bug_report",
      args: { id: 12 },
      result: { id: 12, slug: "neon-snake", title: "Snake wraps through the wall" },
    });
    expect(line.summary).toContain("Snake wraps through the wall");
    expect(line.slug).toBe("neon-snake");
    expect(line.outcome).toBe("ok");
  });

  it("treats a missing report as an answer, not a failure", () => {
    const line = describeToolCall({
      tool: "get_bug_report",
      args: { id: 99 },
      result: null,
    });
    expect(line.outcome).toBe("ok");
    expect(line.summary).toContain("no longer exists");
  });

  it("counts what a list returned and names the filters", () => {
    const line = describeToolCall({
      tool: "list_bug_reports",
      args: { status: "open", slug: "neon-snake" },
      result: { reports: [{ id: 1 }, { id: 2 }], truncated: false },
    });
    expect(line.summary).toBe("Listed 2 reports (open, neon-snake)");
    expect(line.reportId).toBeNull();
  });

  it("uses the agent's own words for the narration tool", () => {
    const line = describeToolCall({
      tool: "log_agent_activity",
      args: { summary: "Reproducing the collision bug", reportId: 5, slug: "neon-snake" },
      result: { ok: true, message: "Noted." },
    });
    // The write-shaped result wins, because a narration that was REFUSED must
    // not render as though it had been recorded.
    expect(line.outcome).toBe("ok");
    expect(line.reportId).toBe(5);
  });

  it("survives a result of a shape it has never seen", () => {
    const line = describeToolCall({ tool: "something_new", args: {}, result: 42 });
    expect(line.summary).toBe("something_new");
    expect(line.outcome).toBe("ok");
  });
});

describe("describeToolFailure", () => {
  it("records the throw, with the error's own message", () => {
    const line = describeToolFailure({
      tool: "list_bug_reports",
      args: {},
      error: new Error("connection refused"),
    });
    expect(line.outcome).toBe("failed");
    expect(line.summary).toBe("list_bug_reports failed: connection refused");
  });

  it("handles something thrown that is not an Error", () => {
    const line = describeToolFailure({ tool: "get_bug_report", args: { id: 3 }, error: "nope" });
    expect(line).toMatchObject({ outcome: "failed", reportId: 3 });
    expect(line.summary).toContain("nope");
  });
});

describe("toSummary", () => {
  it("clips to the column's limit rather than letting the CHECK reject it", () => {
    const line = toSummary("x".repeat(SUMMARY_MAX + 50));
    expect(line.length).toBe(SUMMARY_MAX);
    expect(line.endsWith("…")).toBe(true);
  });

  it("flattens the newlines an agent will inevitably send", () => {
    expect(toSummary("two\n\nlines  here")).toBe("two lines here");
  });
});
