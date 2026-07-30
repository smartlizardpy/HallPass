/**
 * Tests for the pure flair helpers — validation, sanitisation, tone narrowing,
 * and row decoding. No database: this half of the feature is deliberately pure so
 * it runs in the plain `node` env (see the module docblock in `flair.ts`).
 *
 * Invisible characters are written as `\u` escapes rather than pasted, so the
 * source stays reviewable and the intent of each case is legible.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLAIR_TONE,
  MAX_FLAIR_LABEL,
  mapFlairRow,
  normalizeFlairInput,
  toFlairTone,
} from "./flair";

describe("toFlairTone", () => {
  it("accepts every whitelisted tone and rejects everything else", () => {
    expect(toFlairTone("brand")).toBe("brand");
    expect(toFlairTone("gold")).toBe("gold");
    expect(toFlairTone("mauve")).toBeNull();
    expect(toFlairTone("")).toBeNull();
    expect(toFlairTone(null)).toBeNull();
    expect(toFlairTone(42)).toBeNull();
  });
});

describe("normalizeFlairInput", () => {
  it("trims and keeps a normal label, defaulting the tone", () => {
    const result = normalizeFlairInput({ label: "  Beta Tester  " });
    expect(result).toEqual({
      ok: true,
      value: { label: "Beta Tester", icon: null, tone: DEFAULT_FLAIR_TONE },
    });
  });

  it("collapses internal whitespace in the label", () => {
    const result = normalizeFlairInput({ label: "Founding    Member" });
    expect(result.ok && result.value.label).toBe("Founding Member");
  });

  it("rejects a label that is empty after scrubbing", () => {
    // A zero-width space + zero-width joiner scrub to nothing.
    expect(normalizeFlairInput({ label: "\u200b\u200d" })).toEqual({
      ok: false,
      reason: "empty-label",
    });
    // Pure whitespace, likewise.
    expect(normalizeFlairInput({ label: "   " })).toEqual({
      ok: false,
      reason: "empty-label",
    });
  });

  it("rejects a label longer than the maximum", () => {
    const tooLong = "x".repeat(MAX_FLAIR_LABEL + 1);
    expect(normalizeFlairInput({ label: tooLong })).toEqual({
      ok: false,
      reason: "label-too-long",
    });
  });

  it("strips control and bidi characters from the label", () => {
    // A right-to-left override (U+202E) wrapped into visible text — the classic
    // reorder-a-public-row trick — is removed, leaving the plain letters.
    const result = normalizeFlairInput({ label: "a\u202ebc" });
    expect(result.ok && result.value.label).toBe("abc");
  });

  it("keeps an emoji icon but drops a blank one to null", () => {
    expect(normalizeFlairInput({ label: "Staff", icon: "⭐" })).toMatchObject({
      ok: true,
      value: { icon: "⭐" },
    });
    expect(normalizeFlairInput({ label: "Staff", icon: "   " })).toMatchObject({
      ok: true,
      value: { icon: null },
    });
  });

  it("defaults a missing tone but rejects a supplied bad one", () => {
    expect(normalizeFlairInput({ label: "Staff", tone: "" })).toMatchObject({
      ok: true,
      value: { tone: DEFAULT_FLAIR_TONE },
    });
    expect(normalizeFlairInput({ label: "Staff", tone: "chartreuse" })).toEqual({
      ok: false,
      reason: "bad-tone",
    });
  });
});

describe("mapFlairRow", () => {
  it("decodes a row and coerces id/icon/tone", () => {
    expect(
      mapFlairRow({ id: "7", label: "Founder", icon: "\u{1f3db}", tone: "gold" }),
    ).toEqual({ id: 7, label: "Founder", icon: "\u{1f3db}", tone: "gold" });
  });

  it("nulls a missing icon and falls the tone back to the default", () => {
    expect(
      mapFlairRow({ id: 3, label: "Staff", icon: null, tone: "not-a-tone" }),
    ).toEqual({ id: 3, label: "Staff", icon: null, tone: DEFAULT_FLAIR_TONE });
  });
});
