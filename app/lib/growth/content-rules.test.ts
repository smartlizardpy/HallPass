import { describe, expect, it } from "vitest";
import {
  ISSUES,
  THIN_DESCRIPTION_CHARS,
  type GameContent,
  type IssueId,
  assessGame,
  issueLabel,
  summarize,
} from "./content-rules";

/** A game with nothing wrong with it. */
function healthy(over: Partial<GameContent> = {}): GameContent {
  return {
    slug: "duskfall",
    title: "Duskfall",
    description: "x".repeat(THIN_DESCRIPTION_CHARS + 10),
    tags: ["Survivor", "Roguelike"],
    screenshots: 3,
    hasVideo: true,
    reviews: 5,
    ...over,
  };
}

describe("assessGame", () => {
  it("finds nothing wrong with a complete page", () => {
    expect(assessGame(healthy())).toEqual([]);
  });

  it("flags each gap independently", () => {
    expect(assessGame(healthy({ screenshots: 0 }))).toEqual(["no-screenshots"]);
    expect(assessGame(healthy({ tags: [] }))).toEqual(["no-tags"]);
    expect(assessGame(healthy({ hasVideo: false }))).toEqual(["no-video"]);
    expect(assessGame(healthy({ reviews: 0 }))).toEqual(["no-reviews"]);
  });

  it("treats a description at the threshold as thin, one over as fine", () => {
    expect(assessGame(healthy({ description: "x".repeat(THIN_DESCRIPTION_CHARS - 1) })))
      .toEqual(["thin-description"]);
    expect(assessGame(healthy({ description: "x".repeat(THIN_DESCRIPTION_CHARS) })))
      .toEqual([]);
  });

  it("counts a whitespace-only description as missing, not as long", () => {
    const padded = " ".repeat(THIN_DESCRIPTION_CHARS + 50);
    expect(assessGame(healthy({ description: padded }))).toEqual(["thin-description"]);
  });

  /**
   * A list, not a score. A single number would rank the catalogue neatly and
   * tell nobody what to do, and would average one serious gap away under
   * several cosmetic ones.
   */
  it("returns every issue at once, worst-first", () => {
    const bare = healthy({
      description: "",
      tags: [],
      screenshots: 0,
      hasVideo: false,
      reviews: 0,
    });
    expect(assessGame(bare)).toEqual([
      "no-screenshots",
      "thin-description",
      "no-tags",
      "no-video",
      "no-reviews",
    ]);
  });

  it("orders a partial set the same way as the full one", () => {
    const partial = healthy({ hasVideo: false, screenshots: 0 });
    expect(assessGame(partial)).toEqual(["no-screenshots", "no-video"]);
  });
});

describe("issueLabel", () => {
  it("labels every declared issue", () => {
    for (const issue of ISSUES) {
      expect(issueLabel(issue.id)).toBe(issue.label);
    }
  });

  it("falls back to the raw id rather than rendering undefined", () => {
    expect(issueLabel("not-an-issue" as IssueId)).toBe("not-an-issue");
  });
});

describe("summarize", () => {
  it("counts games per issue and keeps every issue in worst-first order", () => {
    const assessed = new Map<string, IssueId[]>([
      ["a", ["no-screenshots", "no-video"]],
      ["b", ["no-video"]],
      ["c", []],
    ]);

    const out = summarize(assessed);
    expect(out.map((s) => s.issue.id)).toEqual(ISSUES.map((i) => i.id));
    expect(out.find((s) => s.issue.id === "no-video")?.count).toBe(2);
    expect(out.find((s) => s.issue.id === "no-screenshots")?.count).toBe(1);
    expect(out.find((s) => s.issue.id === "no-tags")?.count).toBe(0);
  });

  it("reports zeros rather than dropping issues nobody has", () => {
    expect(summarize(new Map())).toHaveLength(ISSUES.length);
    expect(summarize(new Map()).every((s) => s.count === 0)).toBe(true);
  });
});
