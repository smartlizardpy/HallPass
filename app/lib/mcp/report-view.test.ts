/**
 * Tests for the bug MCP's wire mapping.
 *
 * Two properties are worth more than the rest and are asserted hardest:
 *
 *   1. `parseErrorLog` NEVER throws. The text it reads was produced by a game's
 *      runtime and stored as TEXT, so corruption is expected rather than
 *      exceptional, and one bad payload must not fail the call that was listing
 *      the queue.
 *   2. Blob KEYS never reach the wire. They are the write-side addressing of a
 *      bucket holding children's screen recordings; the read-only URLs beside
 *      them are what a reader needs.
 */

import { describe, expect, it } from "vitest";
import type { BetaReport, BetaReportWithAuthor } from "@/app/lib/beta/store";
import {
  parseErrorLog,
  resolveSeverity,
  toReportDetail,
  toReportSummary,
} from "./report-view";

const base: BetaReport = {
  id: 7,
  playerId: "player-1",
  assignmentId: null,
  slug: "neon-snake",
  kind: "bug",
  severity: "major",
  title: "Snake wraps through the wall",
  body: "Going left at the edge puts you on the right-hand side instead of dying.",
  status: "open",
  clipBlobPath: "beta/clips/secret-key.webm",
  clipUrl: "https://blob.example/clip.webm",
  clipBytes: 4096,
  clipMs: 8000,
  shotBlobPath: "beta/shots/secret-key.png",
  shotUrl: "https://blob.example/shot.png",
  errorLog: null,
  errorCount: 0,
  device: "Chromebook / Chrome 141",
  createdAt: "2026-09-01T10:00:00.000Z",
  resolvedBy: null,
  resolvedAt: null,
};

const withAuthor = (over: Partial<BetaReportWithAuthor> = {}): BetaReportWithAuthor => ({
  ...base,
  authorUsername: "snakefan",
  authorHandle: "snakefan#1",
  authorName: "A Tester",
  ...over,
});

describe("parseErrorLog", () => {
  it("reads a well-formed log", () => {
    const raw = JSON.stringify([{ message: "boom", file: "game.js", line: 12, count: 3 }]);
    expect(parseErrorLog(raw)).toEqual([
      { message: "boom", file: "game.js", line: 12, count: 3 },
    ]);
  });

  it("is empty for a report that logged nothing", () => {
    expect(parseErrorLog(null)).toEqual([]);
    expect(parseErrorLog("")).toEqual([]);
  });

  /** The contract. A corrupt payload degrades; it does not throw. */
  it("degrades to empty on malformed JSON instead of throwing", () => {
    expect(() => parseErrorLog("{not json")).not.toThrow();
    expect(parseErrorLog("{not json")).toEqual([]);
    expect(parseErrorLog("undefined")).toEqual([]);
  });

  /**
   * The writer stringifies an ARRAY. Anything else is corruption, and guessing
   * at its shape would invent errors nobody reported.
   */
  it("drops a non-array payload rather than wrapping it", () => {
    expect(parseErrorLog('{"message":"boom"}')).toEqual([]);
    expect(parseErrorLog('"a string"')).toEqual([]);
    expect(parseErrorLog("null")).toEqual([]);
    expect(parseErrorLog("42")).toEqual([]);
  });
});

describe("resolveSeverity", () => {
  it("keeps the tester's severity on a bug when nothing overrides it", () => {
    expect(resolveSeverity({ kind: "bug", severity: "minor" }, undefined)).toBe("minor");
    expect(resolveSeverity({ kind: "bug", severity: "minor" }, null)).toBe("minor");
  });

  /** Triage is the moment a tester's guess at their own payout gets corrected. */
  it("lets an override win on a bug", () => {
    expect(resolveSeverity({ kind: "bug", severity: "blocker" }, "cosmetic")).toBe(
      "cosmetic",
    );
  });

  /**
   * The cross-field CHECK rejects a severity on a feature, so letting one
   * through would turn a caller's stray argument into a 500.
   */
  it("forces null on a feature, whatever is passed", () => {
    expect(resolveSeverity({ kind: "feature", severity: null }, "blocker")).toBeNull();
    expect(resolveSeverity({ kind: "feature", severity: "major" }, undefined)).toBeNull();
  });
});

describe("toReportSummary", () => {
  it("reports evidence as presence, not as URLs", () => {
    const summary = toReportSummary(base);
    expect(summary.hasClip).toBe(true);
    expect(summary.hasScreenshot).toBe(true);
    expect(toReportSummary({ ...base, clipUrl: null, shotUrl: null })).toMatchObject({
      hasClip: false,
      hasScreenshot: false,
    });
  });

  it("carries the fields needed to choose what to work on", () => {
    expect(toReportSummary(base)).toMatchObject({
      id: 7,
      slug: "neon-snake",
      kind: "bug",
      severity: "major",
      status: "open",
      errorCount: 0,
    });
  });

  /** The leak this shape exists to prevent. */
  it("never exposes a blob key", () => {
    const wire = JSON.stringify(toReportSummary(base));
    expect(wire).not.toContain("secret-key");
    expect(wire).not.toContain("clipBlobPath");
    expect(wire).not.toContain("shotBlobPath");
  });
});

describe("toReportDetail", () => {
  it("adds what is needed to reproduce the bug", () => {
    const detail = toReportDetail(
      withAuthor({ errorLog: JSON.stringify([{ message: "boom" }]), errorCount: 1 }),
    );
    expect(detail.body).toContain("Going left at the edge");
    expect(detail.device).toBe("Chromebook / Chrome 141");
    expect(detail.errors).toEqual([{ message: "boom" }]);
    expect(detail.clipUrl).toBe("https://blob.example/clip.webm");
    expect(detail.screenshotUrl).toBe("https://blob.example/shot.png");
  });

  it("prefers the claimed username for the author", () => {
    expect(toReportDetail(withAuthor()).author).toBe("snakefan");
    expect(toReportDetail(withAuthor({ authorUsername: null })).author).toBe("snakefan#1");
    expect(
      toReportDetail(withAuthor({ authorUsername: null, authorHandle: null })).author,
    ).toBe("A Tester");
  });

  /**
   * `player_id` is ON DELETE SET NULL, so a report outlives its author. That is
   * still a real bug and is reported with no author rather than hidden.
   */
  it("reports an orphaned report with a null author rather than failing", () => {
    const orphan = withAuthor({
      playerId: null,
      authorUsername: null,
      authorHandle: null,
      authorName: null,
    });
    expect(toReportDetail(orphan).author).toBeNull();
    expect(toReportDetail(orphan).id).toBe(7);
  });

  it("never exposes a blob key", () => {
    const wire = JSON.stringify(toReportDetail(withAuthor()));
    expect(wire).not.toContain("secret-key");
  });
});
