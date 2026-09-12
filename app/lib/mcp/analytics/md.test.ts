/**
 * Tests for the Markdown renderers.
 *
 * The escaping cases are the point. A pipe ends a cell and a newline ends the
 * row, so an un-escaped value does not render badly — it silently shifts every
 * later column, which looks plausible and is wrong. Review bodies and game
 * descriptions contain both characters routinely.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_CELL_LENGTH,
  MAX_TABLE_COLUMNS,
  mdCell,
  mdHeading,
  mdList,
  mdNumber,
  mdRows,
  mdSections,
  mdStat,
  mdTable,
} from "./md";

describe("mdCell", () => {
  it("escapes a pipe, which would otherwise open a new column", () => {
    expect(mdCell("a|b")).toBe("a\\|b");
  });

  it("flattens newlines, which would otherwise end the row", () => {
    expect(mdCell("line one\nline two")).toBe("line one line two");
    expect(mdCell("crlf\r\nhere")).toBe("crlf here");
  });

  it("renders null, undefined and empty as an em dash, not as blank", () => {
    expect(mdCell(null)).toBe("—");
    expect(mdCell(undefined)).toBe("—");
    expect(mdCell("   ")).toBe("—");
  });

  it("keeps zero and false, which are answers and not absences", () => {
    expect(mdCell(0)).toBe("0");
    expect(mdCell(false)).toBe("false");
  });

  it("serialises an object rather than printing [object Object]", () => {
    expect(mdCell({ a: 1 })).toBe('{"a":1}');
  });

  it("truncates a very long cell", () => {
    const cell = mdCell("x".repeat(500));
    expect(cell).toHaveLength(MAX_CELL_LENGTH);
    expect(cell.endsWith("…")).toBe(true);
  });
});

describe("mdTable", () => {
  it("renders a header, a rule and the rows", () => {
    expect(mdTable(["a", "b"], [[1, 2]])).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
  });

  it("returns empty for no rows, so callers can branch", () => {
    expect(mdTable(["a"], [])).toBe("");
    expect(mdTable([], [[1]])).toBe("");
  });
});

describe("mdRows", () => {
  it("says so plainly when there is nothing", () => {
    expect(mdRows([])).toBe("_No rows._");
  });

  it("takes columns from the first row, since a result set is rectangular", () => {
    const out = mdRows([{ a: 1 }, { a: 2, b: 3 }]);
    expect(out).toContain("| a |");
    expect(out).not.toContain("| b |");
  });

  it("REPORTS row truncation rather than clipping silently", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ n: i }));
    const out = mdRows(rows, { maxRows: 3 });
    expect(out).toContain("Showing 3 of 10 rows");
  });

  it("names the columns it dropped", () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < MAX_TABLE_COLUMNS + 2; i++) wide[`c${i}`] = i;
    const out = mdRows([wide]);
    expect(out).toContain("further column(s) omitted");
    expect(out).toContain(`c${MAX_TABLE_COLUMNS}`);
  });

  it("escapes inside generated tables too", () => {
    expect(mdRows([{ body: "great game | 10/10" }])).toContain("great game \\| 10/10");
  });
});

describe("mdList / mdSections", () => {
  it("skips falsy entries so callers can inline conditionals", () => {
    expect(mdList(["one", null, false, undefined, "two"])).toBe("- one\n- two");
    expect(mdSections(["a", null, "b"])).toBe("a\n\nb");
  });

  it("collapses the blank runs conditionals leave behind", () => {
    expect(mdSections(["a", "", "", "b"])).toBe("a\n\nb");
  });
});

describe("mdHeading / mdNumber / mdStat", () => {
  it("clamps the heading level", () => {
    expect(mdHeading("x", 0)).toBe("# x");
    expect(mdHeading("x", 99)).toBe("###### x");
  });

  it("formats a number with separators and emphasis", () => {
    expect(mdNumber(1204)).toBe("**1,204**");
  });

  it("carries the caveat a bare number never could", () => {
    expect(mdStat("Plays", "**141**", "last 30 days, PostHog")).toBe(
      "Plays: **141** — _last 30 days, PostHog_",
    );
    expect(mdStat("Plays", "**141**")).toBe("Plays: **141**");
  });
});
