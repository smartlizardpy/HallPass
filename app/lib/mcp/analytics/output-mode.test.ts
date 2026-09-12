/**
 * Tests for the widget/Markdown output setting.
 *
 * The property that matters is that an OPERATOR'S CHOICE OUTRANKS THE GUESS.
 * The client-name list is a heuristic — the protocol has no capability to
 * negotiate against — so `widget` and `markdown` must be absolute, or somebody
 * staring at an empty box has no way to fix it.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTPUT_MODE,
  OUTPUT_MODES,
  OUTPUT_MODE_HINT,
  OUTPUT_MODE_LABEL,
  clientHintFrom,
  shouldSendWidgets,
  toOutputMode,
} from "./output-mode";

describe("toOutputMode", () => {
  it("defaults an unwritten key to the never-broken option", () => {
    expect(toOutputMode(null)).toBe("auto");
    expect(toOutputMode(undefined)).toBe("auto");
    expect(DEFAULT_OUTPUT_MODE).toBe("auto");
  });

  it("accepts the three modes and nothing else", () => {
    for (const mode of OUTPUT_MODES) expect(toOutputMode(mode)).toBe(mode);
    expect(toOutputMode("cards")).toBe("auto");
    expect(toOutputMode(42)).toBe("auto");
    expect(toOutputMode("WIDGET")).toBe("auto");
  });
});

describe("shouldSendWidgets", () => {
  it("never sends widgets in markdown mode, whoever is asking", () => {
    for (const client of ["ChatGPT", "Claude", "openai-mcp", null, ""]) {
      expect(shouldSendWidgets("markdown", client)).toBe(false);
    }
  });

  it("always sends widgets in widget mode, whoever is asking", () => {
    for (const client of ["ChatGPT", "Claude", "some-cli", null, ""]) {
      expect(shouldSendWidgets("widget", client)).toBe(true);
    }
  });

  it("in auto, sends to hints that look like a client known to render them", () => {
    expect(shouldSendWidgets("auto", "https://chatgpt.com")).toBe(true);
    expect(shouldSendWidgets("auto", "chatgpt-connector/1.0")).toBe(true);
    expect(shouldSendWidgets("auto", "openai-mcp")).toBe(true);
  });

  it("in auto, withholds them from everyone else", () => {
    // Claude is the case this protects: its tracker has a spec-correct custom
    // remote connector whose widget never renders, closed as not planned.
    expect(shouldSendWidgets("auto", "Claude")).toBe(false);
    expect(shouldSendWidgets("auto", "claude-code")).toBe(false);
    expect(shouldSendWidgets("auto", "mcp-inspector")).toBe(false);
  });

  it("in auto, withholds them from a client that gave no hint at all", () => {
    expect(shouldSendWidgets("auto", null)).toBe(false);
    expect(shouldSendWidgets("auto", "")).toBe(false);
  });
});

describe("clientHintFrom", () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it("prefers the origin, which a page cannot forge", () => {
    expect(clientHintFrom(h({ origin: "https://ChatGPT.com" }))).toContain("chatgpt.com");
  });

  it("falls back to the user agent for a non-browser caller", () => {
    expect(clientHintFrom(h({ "user-agent": "openai-mcp/1.2" }))).toContain("openai-mcp");
  });

  it("is empty when a caller sends neither, which auto reads as \"not known\"", () => {
    expect(clientHintFrom(h({}))).toBe("");
    expect(shouldSendWidgets("auto", clientHintFrom(h({})))).toBe(false);
  });

  it("carries a CLI through to a no-widget decision in auto", () => {
    const hint = clientHintFrom(h({ "user-agent": "node" }));
    expect(shouldSendWidgets("auto", hint)).toBe(false);
    expect(shouldSendWidgets("widget", hint)).toBe(true);
  });
});

describe("the dashboard copy", () => {
  it("labels and explains every mode, so the select cannot render a blank", () => {
    for (const mode of OUTPUT_MODES) {
      expect(OUTPUT_MODE_LABEL[mode]).toBeTruthy();
      expect(OUTPUT_MODE_HINT[mode].length).toBeGreaterThan(20);
    }
  });
});
