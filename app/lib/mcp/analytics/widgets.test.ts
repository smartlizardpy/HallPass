/**
 * Tests for what the card DECLARES.
 *
 * The metadata is plain frozen data now precisely so it can be asserted rather
 * than trusted, and the single most valuable assertion in this file is that one
 * URI reaches three keys and cannot drift: a host reads whichever of them it
 * knows, and a card whose nested key points somewhere its flat key does not is
 * a card that renders for some people and not others.
 *
 * The CSP invariants are the other half. The resource deliberately declares no
 * `csp`, which makes the host apply its restrictive default — `default-src
 * 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
 * img-src 'self' data:; connect-src 'none'`. Under that policy an external
 * script, a stylesheet link, an `@import` or a `fetch()` is not a slow path, it
 * is a silently dropped one. These assertions are what stops somebody adding a
 * CDN to this file and only finding out inside somebody else's chat window.
 */

import { describe, expect, it } from "vitest";
import {
  REPORT_RESOURCE_META,
  REPORT_TOOL_META,
  REPORT_WIDGET_HTML,
  REPORT_WIDGET_SCRIPT,
  REPORT_WIDGET_STYLE,
  REPORT_WIDGET_URI,
  UI_PROTOCOL_VERSION,
  WIDGET_MIME_TYPE,
} from "./widgets";

describe("what a tool descriptor declares", () => {
  it("points all three keys at the one resource, so they cannot drift", () => {
    const ui = REPORT_TOOL_META.ui as { resourceUri: string; visibility: string[] };
    expect(ui.resourceUri).toBe(REPORT_WIDGET_URI);
    // The deprecated flat alias the extension still tells hosts to check.
    expect(REPORT_TOOL_META["ui/resourceUri"]).toBe(REPORT_WIDGET_URI);
    // ChatGPT's own Apps SDK key.
    expect(REPORT_TOOL_META["openai/outputTemplate"]).toBe(REPORT_WIDGET_URI);
  });

  it("does not advertise that the card calls tools back, because it cannot", () => {
    const ui = REPORT_TOOL_META.ui as { visibility: string[] };
    expect(ui.visibility).toEqual(["model"]);
  });

  it("is frozen, so no caller can mutate the shared object", () => {
    expect(Object.isFrozen(REPORT_TOOL_META)).toBe(true);
    expect(Object.isFrozen(REPORT_RESOURCE_META)).toBe(true);
  });
});

describe("what the resource declares", () => {
  it("uses the two spellings the spec makes mandatory", () => {
    expect(WIDGET_MIME_TYPE).toBe("text/html;profile=mcp-app");
    expect(REPORT_WIDGET_URI.startsWith("ui://")).toBe(true);
  });

  it("declares no CSP, so the host's restrictive default applies", () => {
    // Widening the sandbox must be a deliberate, reviewed act — not something
    // that arrives with "just add a CDN".
    expect(REPORT_RESOURCE_META).not.toHaveProperty("csp");
    expect(REPORT_RESOURCE_META.ui).not.toHaveProperty("csp");
  });

  it("says whether it wants a border rather than leaving hosts to differ", () => {
    expect((REPORT_RESOURCE_META.ui as { prefersBorder: boolean }).prefersBorder).toBe(false);
  });
});

describe("the document survives the default CSP", () => {
  const forbidden: [string, string][] = [
    ["<script src", "an external script is blocked by script-src 'self'"],
    ['<link rel="stylesheet"', "an external stylesheet is blocked by style-src 'self'"],
    ["@import", "an imported stylesheet is blocked the same way"],
    ["https://", "no absolute URL belongs in a document with connect-src 'none'"],
    ["http://", "likewise"],
    ["fetch(", "connect-src 'none' drops it"],
    ["XMLHttpRequest", "connect-src 'none' drops it"],
    ['target="_blank"', "a sandboxed iframe has no allow-popups; use ui/open-link"],
  ];

  for (const [needle, why] of forbidden) {
    it(`contains no ${JSON.stringify(needle)} — ${why}`, () => {
      expect(REPORT_WIDGET_HTML).not.toContain(needle);
    });
  }

  it("is one document with both halves inlined", () => {
    expect(REPORT_WIDGET_HTML).toContain(REPORT_WIDGET_STYLE);
    expect(REPORT_WIDGET_HTML).toContain(REPORT_WIDGET_SCRIPT);
    expect(REPORT_WIDGET_HTML.startsWith("<!doctype html>")).toBe(true);
  });
});

describe("the script keeps the handshake vocabulary", () => {
  // Losing any one of these is the failure that has no symptom in a unit test
  // and no symptom in a browser either — just a card that never fills in. Name
  // them so a refactor that drops one fails loudly.
  const required = [
    "ui/initialize",
    "ui/notifications/initialized",
    "ui/notifications/tool-result",
    "ui/notifications/host-context-changed",
    "ui/notifications/size-changed",
    "ui/open-link",
    "ui/resource-teardown",
  ];

  for (const method of required) {
    it(`still speaks ${method}`, () => {
      expect(REPORT_WIDGET_SCRIPT).toContain(method);
    });
  }

  it("announces the protocol version this file is pinned to", () => {
    expect(UI_PROTOCOL_VERSION).toBe("2026-01-26");
    expect(REPORT_WIDGET_SCRIPT).toContain(UI_PROTOCOL_VERSION);
  });
});
