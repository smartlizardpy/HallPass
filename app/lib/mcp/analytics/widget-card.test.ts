// @vitest-environment jsdom

/**
 * Tests for what the card DOES — by being the host.
 *
 * This is the test that would have caught the original bug. The card never
 * rendered anywhere, in any client, and no unit test could see it: the metadata
 * was well-formed, the HTML was valid, and the document simply waited for a
 * message that a spec-compliant host will never send to a view that has not
 * announced itself. The only way to catch that is to play the host and check
 * the order of what the view says.
 *
 * So each case below drives the real message sequence over `postMessage` and
 * asserts against the DOM. The script is run with `new Function` rather than
 * injected as a `<script>` tag because jsdom does not execute inline scripts
 * without `runScripts`, and because a bare function call is easier to reason
 * about than a document lifecycle.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPORT_WIDGET_SCRIPT, type WidgetPayload } from "./widgets";

const PAYLOAD: WidgetPayload = {
  kind: "hallpass-report",
  title: "Arcade overview",
  subtitle: "Last 30 days",
  stats: [
    { label: "Plays", value: "1,234", deltaPct: 12.5, deltaPrev: "1,097", spark: [1, 4, 2, 8] },
    { label: "Active (7d)", value: "88", note: "signed in, not played" },
  ],
  tables: [{ title: "Top games", headers: ["Game", "Plays"], rows: [["duskfall", "512"], ["neon", "310"]] }],
  notes: ["PostHog counts devices, not people."],
  url: "https://example.test/dashboard",
};

let sent: Record<string, unknown>[];

/** Run the card, with this test file standing in for the parent frame. */
function mount() {
  document.body.innerHTML = '<div id="root"><p class="empty">Loading the report…</p></div>';
  new Function(REPORT_WIDGET_SCRIPT)();
}

/** Deliver a message to the card the way a host's iframe bridge would. */
function deliver(message: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data: message }));
}

/** Answer the card's `ui/initialize`, which is what unblocks everything else. */
function completeHandshake(extra: Record<string, unknown> = {}) {
  const init = sent.find((m) => m.method === "ui/initialize");
  deliver({
    jsonrpc: "2.0",
    id: (init as { id: number }).id,
    result: { protocolVersion: "2026-01-26", hostCapabilities: {}, hostContext: {}, ...extra },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  Object.defineProperty(window, "parent", {
    value: { postMessage: (m: Record<string, unknown>) => sent.push(m) },
    configurable: true,
    writable: true,
  });
  // jsdom implements neither, and the card must not depend on either existing.
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // @ts-expect-error - the legacy global is set by one test only.
  delete window.openai;
});

describe("the handshake", () => {
  it("announces itself, unprompted, as soon as it mounts", () => {
    mount();
    const init = sent[0] as { jsonrpc: string; id: number; method: string; params: Record<string, unknown> };
    expect(init.jsonrpc).toBe("2.0");
    expect(init.method).toBe("ui/initialize");
    expect(init.id).toBeTypeOf("number");
    expect(init.params.protocolVersion).toBe("2026-01-26");
    expect(init.params.appInfo).toMatchObject({ name: expect.any(String) });
    expect(init.params.appCapabilities).toMatchObject({ availableDisplayModes: ["inline"] });
  });

  it("sends initialized only AFTER the result, never before", async () => {
    mount();
    // The gate: before the host answers, the card must not claim to be ready.
    expect(sent.some((m) => m.method === "ui/notifications/initialized")).toBe(false);

    completeHandshake();
    await vi.advanceTimersByTimeAsync(0);

    const initIndex = sent.findIndex((m) => m.method === "ui/initialize");
    const readyIndex = sent.findIndex((m) => m.method === "ui/notifications/initialized");
    expect(readyIndex).toBeGreaterThan(initIndex);
  });

  it("answers ui/resource-teardown, which is a request and not a notification", async () => {
    mount();
    completeHandshake();
    await vi.advanceTimersByTimeAsync(0);

    deliver({ jsonrpc: "2.0", id: 99, method: "ui/resource-teardown", params: {} });
    expect(sent.some((m) => m.id === 99 && "result" in m)).toBe(true);
  });
});

describe("rendering a result", () => {
  async function mountAndDeliverPayload(payload: unknown = PAYLOAD, hostExtra = {}) {
    mount();
    completeHandshake(hostExtra);
    await vi.advanceTimersByTimeAsync(0);
    deliver({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { content: [{ type: "text", text: "the markdown answer" }], structuredContent: payload },
    });
    await vi.advanceTimersByTimeAsync(0);
  }

  it("draws the payload the host pushes", async () => {
    await mountAndDeliverPayload();
    const root = document.getElementById("root")!;
    expect(root.querySelector("h1")?.textContent).toBe("Arcade overview");
    expect(root.querySelectorAll(".stat")).toHaveLength(2);
    expect(root.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(root.textContent).toContain("PostHog counts devices, not people.");
  });

  it("renders a delta pill, and a sparkline where there is a series", async () => {
    await mountAndDeliverPayload();
    expect(document.querySelector(".pill.up")?.textContent).toContain("12.5%");
    expect(document.querySelector(".spark svg")).not.toBeNull();
  });

  it("says so in words when handed a payload it does not recognise", async () => {
    await mountAndDeliverPayload({ kind: "something-else" });
    const root = document.getElementById("root")!;
    // The whole point: never a blank box.
    expect(root.textContent?.trim()).not.toBe("");
    expect(root.querySelector(".empty")?.textContent).toContain("could not be displayed");
  });
});

describe("wearing the host's theme", () => {
  it("takes the theme and the style variables the host sends", async () => {
    mount();
    completeHandshake({
      hostContext: {
        theme: "dark",
        styles: { variables: { "--color-background-primary": "rgb(1, 2, 3)" } },
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    const root = document.documentElement;
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.style.getPropertyValue("--color-background-primary")).toBe("rgb(1, 2, 3)");
  });
});

describe("telling the host how tall it is", () => {
  it("reports a size once it is connected and has drawn something", async () => {
    mount();
    completeHandshake();
    await vi.advanceTimersByTimeAsync(0);
    deliver({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { structuredContent: PAYLOAD },
    });
    await vi.advanceTimersByTimeAsync(50);

    const size = sent.find((m) => m.method === "ui/notifications/size-changed") as
      | { params: { width: number; height: number } }
      | undefined;
    expect(size).toBeDefined();
    expect(size!.params.width).toBeTypeOf("number");
    expect(size!.params.height).toBeTypeOf("number");
  });
});

describe("the dashboard link", () => {
  it("goes through the host when the host says it opens links", async () => {
    mount();
    completeHandshake({ hostCapabilities: { openLinks: {} } });
    await vi.advanceTimersByTimeAsync(0);
    deliver({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { structuredContent: PAYLOAD },
    });
    await vi.advanceTimersByTimeAsync(0);

    const button = document.getElementById("open");
    expect(button).not.toBeNull();
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const open = sent.find((m) => m.method === "ui/open-link") as { params: { url: string } };
    expect(open.params.url).toBe(PAYLOAD.url);
  });

  it("offers a readable URL instead of a dead button when it does not", async () => {
    mount();
    completeHandshake({ hostCapabilities: {} });
    await vi.advanceTimersByTimeAsync(0);
    deliver({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { structuredContent: PAYLOAD },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(document.getElementById("open")).toBeNull();
    expect(document.querySelector(".srcnote")?.textContent).toContain(PAYLOAD.url!);
  });
});

describe("hosts that do not implement the extension", () => {
  it("never spins: it says what happened when nobody answers", async () => {
    mount();
    // No response to ui/initialize, ever.
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelector(".empty")?.textContent).toContain("could not be displayed");
  });

  it("still reads the legacy ChatGPT global", () => {
    // @ts-expect-error - modelling a host that predates the extension.
    window.openai = { toolOutput: PAYLOAD };
    mount();
    expect(document.querySelector("h1")?.textContent).toBe("Arcade overview");
  });
});
