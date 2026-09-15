/**
 * Tests for the card/Markdown output setting.
 *
 * Two properties matter now, and they are not the ones this file used to
 * assert:
 *
 *   * AN OPERATOR'S CHOICE IS ABSOLUTE. `markdown` withholds the card from
 *     everyone, because it is the only remedy somebody staring at a broken box
 *     has, and it has to work on the next request.
 *   * A STORED CHOICE SURVIVES THE RENAME. `auto` and `widget` were the old
 *     names; rows carrying them are still in `app_settings`, and an operator
 *     who chose one once must not silently end up on a different setting.
 *
 * What this file NO LONGER asserts is the interesting part. It used to test
 * that Claude was withheld from and that a hint of `chatgpt` was matched — a
 * heuristic that was wrong in both directions: the header evidence is absent
 * from backend-to-backend callers, and the extension's own client matrix
 * records Claude as implementing MCP Apps. See `output-mode.ts`'s header.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTPUT_MODE,
  OUTPUT_MODES,
  OUTPUT_MODE_HINT,
  OUTPUT_MODE_LABEL,
  shouldDeclareUi,
  toOutputMode,
} from "./output-mode";

describe("toOutputMode", () => {
  it("defaults an unwritten key to offering the card", () => {
    expect(toOutputMode(null)).toBe("cards");
    expect(toOutputMode(undefined)).toBe("cards");
    expect(DEFAULT_OUTPUT_MODE).toBe("cards");
  });

  it("accepts the two modes and nothing else", () => {
    for (const mode of OUTPUT_MODES) expect(toOutputMode(mode)).toBe(mode);
    expect(toOutputMode(42)).toBe("cards");
    expect(toOutputMode("MARKDOWN")).toBe("cards");
    expect(toOutputMode("nonsense")).toBe("cards");
  });

  it("carries the pre-2026 names onto the setting that means the same thing", () => {
    // The migration contract. Both old names meant "declare where we think it
    // will render", so both land on `cards`; only an explicit `markdown` —
    // which an operator picks after SEEING something broken — still withholds.
    expect(toOutputMode("auto")).toBe("cards");
    expect(toOutputMode("widget")).toBe("cards");
    expect(toOutputMode("markdown")).toBe("markdown");
  });
});

describe("shouldDeclareUi", () => {
  it("offers the card in every mode but text-only", () => {
    expect(shouldDeclareUi("cards")).toBe(true);
    expect(shouldDeclareUi("markdown")).toBe(false);
  });

  it("does not consult who is calling, because there is nothing worth reading", () => {
    // Guards the whole point of the rewrite: the decision is a function of the
    // operator's setting and nothing else. If this ever grows a second
    // parameter again, it should be the negotiated client capability, not a
    // header sniff.
    expect(shouldDeclareUi.length).toBe(1);
  });
});

describe("the dashboard copy", () => {
  it("labels and explains every mode, so the radio group cannot render a blank", () => {
    for (const mode of OUTPUT_MODES) {
      expect(OUTPUT_MODE_LABEL[mode]).toBeTruthy();
      expect(OUTPUT_MODE_HINT[mode]).toBeTruthy();
    }
  });

  it("no longer promises a guess it does not make", () => {
    const copy = Object.values(OUTPUT_MODE_HINT).join(" ").toLowerCase();
    expect(copy).not.toContain("look like");
    expect(copy).not.toContain("known to render");
  });
});
