import { describe, expect, it } from "vitest";
import { snippet } from "@/app/lib/snippet";

describe("snippet", () => {
  it("leaves short text alone", () => {
    expect(snippet("Short one.")).toBe("Short one.");
  });

  it("ends on a sentence boundary when one fits", () => {
    const text = `${"A".repeat(80)}. Second sentence that runs on and on and on past the limit of the snippet length.`;
    expect(snippet(text)).toBe(`${"A".repeat(80)}.`);
  });

  it("falls back to a word boundary with an ellipsis, never mid-word", () => {
    const text = "word ".repeat(60).trim();
    const out = snippet(text);
    expect(out.length).toBeLessThanOrEqual(155);
    expect(out.endsWith("word…")).toBe(true);
  });
});
