/**
 * Tests for the survey vocabulary.
 *
 * Pure, so cheap. They pin what a database CHECK enforces but TypeScript cannot:
 * the status and kind lists, the slug pattern and the option-id stability that
 * keeps stored answers pointing at the right choice.
 */

import { describe, expect, it } from "vitest";
import {
  OPTIONS_MAX,
  OPTION_LABEL_MAX,
  QUESTION_KINDS,
  QUESTION_KIND_LABEL,
  SLUG_PATTERN,
  SURVEY_STATUSES,
  SURVEY_STATUS_CHIP_CLASS,
  SURVEY_STATUS_HINT,
  SURVEY_STATUS_LABEL,
  assignOptionIds,
  checkQuestion,
  hasOptions,
  parseOptionLabels,
  toOptions,
  toQuestionKind,
  toSlug,
  toSurveyStatus,
} from "./config";

describe("statuses and kinds", () => {
  it("matches the CHECK constraints in 037_surveys.sql", () => {
    expect([...SURVEY_STATUSES]).toEqual(["draft", "live", "closed"]);
    expect([...QUESTION_KINDS]).toEqual(["single", "multi", "scale", "text"]);
  });

  it("labels every status and kind", () => {
    for (const status of SURVEY_STATUSES) {
      expect(SURVEY_STATUS_LABEL[status]).toBeTruthy();
      expect(SURVEY_STATUS_HINT[status]).toBeTruthy();
      expect(SURVEY_STATUS_CHIP_CLASS[status]).toBeTruthy();
    }
    for (const kind of QUESTION_KINDS) expect(QUESTION_KIND_LABEL[kind]).toBeTruthy();
  });

  it("narrows untrusted strings", () => {
    expect(toSurveyStatus("live")).toBe("live");
    expect(toSurveyStatus("LIVE")).toBeNull();
    expect(toQuestionKind("scale")).toBe("scale");
    expect(toQuestionKind("ranking")).toBeNull();
  });

  it("gives options to the two choice kinds only", () => {
    expect(hasOptions("single")).toBe(true);
    expect(hasOptions("multi")).toBe(true);
    expect(hasOptions("scale")).toBe(false);
    expect(hasOptions("text")).toBe(false);
  });
});

describe("toSlug", () => {
  it("hyphenates and lowercases a title", () => {
    expect(toSlug("  Winter Release Survey! ")).toBe("winter-release-survey");
    expect(toSlug("snake_case name")).toBe("snake-case-name");
  });

  it("returns null when nothing usable is left", () => {
    expect(toSlug("!!!")).toBeNull();
    expect(toSlug("")).toBeNull();
  });

  it("always satisfies the CHECK pattern and the 48-char cap", () => {
    const slug = toSlug("a".repeat(100) + "-b");
    expect(slug).not.toBeNull();
    expect(slug!.length).toBeLessThanOrEqual(48);
    expect(SLUG_PATTERN.test(slug!)).toBe(true);
  });
});

describe("parseOptionLabels", () => {
  it("trims, drops blanks and case-insensitive duplicates", () => {
    expect(parseOptionLabels("  Racing \n\nracing\nPuzzle  \n")).toEqual(["Racing", "Puzzle"]);
  });

  it("accepts an array as well as text", () => {
    expect(parseOptionLabels(["a", " b ", "A"])).toEqual(["a", "b"]);
  });

  it("caps label length and option count", () => {
    const labels = parseOptionLabels(
      Array.from({ length: OPTIONS_MAX + 5 }, (_, i) => `${"x".repeat(200)}${i}`),
    );
    expect(labels.length).toBeLessThanOrEqual(OPTIONS_MAX);
    for (const label of labels) expect(label.length).toBeLessThanOrEqual(OPTION_LABEL_MAX);
  });
});

describe("assignOptionIds", () => {
  it("numbers fresh options o1, o2, ...", () => {
    expect(assignOptionIds(["A", "B"])).toEqual([
      { id: "o1", label: "A" },
      { id: "o2", label: "B" },
    ]);
  });

  it("keeps the id of an option whose label survives an edit, however it is reordered", () => {
    const existing = [
      { id: "o1", label: "Racing" },
      { id: "o2", label: "Puzzle" },
    ];
    expect(assignOptionIds(["puzzle", "Racing", "Sports"], existing)).toEqual([
      { id: "o2", label: "puzzle" },
      { id: "o1", label: "Racing" },
      { id: "o3", label: "Sports" },
    ]);
  });

  it("never reuses the id of a removed option", () => {
    const existing = [
      { id: "o1", label: "A" },
      { id: "o2", label: "B" },
    ];
    // B removed; a new option must not inherit o2 or old answers would re-point.
    expect(assignOptionIds(["A", "C"], existing)).toEqual([
      { id: "o1", label: "A" },
      { id: "o3", label: "C" },
    ]);
  });
});

describe("toOptions", () => {
  it("keeps well-formed entries and drops the rest", () => {
    expect(toOptions([{ id: "o1", label: "A" }, { id: 2 }, null, "x"])).toEqual([
      { id: "o1", label: "A" },
    ]);
    expect(toOptions("nope")).toEqual([]);
  });
});

describe("checkQuestion", () => {
  it("trims the prompt and drops options a non-choice question cannot have", () => {
    expect(checkQuestion("text", "  Anything else?  ", ["ignored", "also ignored"])).toEqual({
      ok: true,
      prompt: "Anything else?",
      optionLabels: [],
    });
    expect(checkQuestion("scale", "Rate the art", undefined)).toMatchObject({ ok: true });
  });

  it("refuses an empty prompt", () => {
    expect(checkQuestion("text", "   ", undefined)).toMatchObject({ ok: false });
    expect(checkQuestion("text", undefined, undefined)).toMatchObject({ ok: false });
  });

  it("needs two different options on a choice question, from text or a list", () => {
    expect(checkQuestion("single", "Genre?", "Racing")).toMatchObject({ ok: false });
    expect(checkQuestion("multi", "Genre?", ["Racing", "racing"])).toMatchObject({ ok: false });
    expect(checkQuestion("single", "Genre?", "Racing\nPuzzle")).toEqual({
      ok: true,
      prompt: "Genre?",
      optionLabels: ["Racing", "Puzzle"],
    });
    expect(checkQuestion("multi", "Genre?", ["A", "B"])).toMatchObject({ ok: true });
  });

  it("caps the prompt at the column limit", () => {
    const result = checkQuestion("text", "x".repeat(1000), undefined);
    expect(result.ok && result.prompt.length).toBe(300);
  });
});
