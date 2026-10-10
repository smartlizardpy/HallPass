// @vitest-environment jsdom

/**
 * Tests for the challenge picker helper.
 *
 * jsdom per-file, matching the other browser-side SDK tests. The properties
 * worth pinning are the ones a bug would make silent: a signal that fires twice
 * would settle a game's promise twice, and a `postMessage` listener that skips
 * its origin check would let any frame on a third-party page fake a challenge.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHALLENGE_SIGNAL_KEY,
  FRAME_SIZE_TYPE,
  isSameOrigin,
  openInlinePicker,
  pickerUrl,
  subscribeChallengeSignals,
} from "./challenge";

const API = "http://localhost:3000";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("pickerUrl", () => {
  it("omits parameters that were not given", () => {
    expect(pickerUrl(API)).toBe(`${API}/embed/challenge`);
  });

  it("includes game and board when present", () => {
    expect(pickerUrl(API, { game: "duskfall", board: "duskfall-hi" })).toBe(
      `${API}/embed/challenge?game=duskfall&board=duskfall-hi`,
    );
  });

  it("encodes values rather than splicing them", () => {
    expect(pickerUrl(API, { game: "a b&c=d" })).toBe(
      `${API}/embed/challenge?game=a%20b%26c%3Dd`,
    );
  });

  it("treats empty strings and null as absent", () => {
    expect(pickerUrl(API, { game: "", board: null })).toBe(`${API}/embed/challenge`);
  });
});

describe("isSameOrigin", () => {
  it("is true for the origin the page is on", () => {
    expect(isSameOrigin(window.location.origin)).toBe(true);
  });

  it("is false for another origin", () => {
    expect(isSameOrigin("https://elsewhere.example")).toBe(false);
  });

  it("reads a relative or unparsable api as NOT same-origin", () => {
    // Parsed with no base, matching the rule client.ts now delegates here. The
    // cautious answer: false selects the popup and the full-page redirect,
    // which work in strictly more situations than their alternatives.
    expect(isSameOrigin("")).toBe(false);
    expect(isSameOrigin("/")).toBe(false);
    expect(isSameOrigin("::::")).toBe(false);
  });
});

describe("openInlinePicker", () => {
  it("adds one small frame and removes it on close", () => {
    const picker = openInlinePicker(pickerUrl(API));
    expect(picker).not.toBeNull();

    const frame = document.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("style")).toContain("position:fixed");

    picker?.close();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("does not cover the whole viewport", () => {
    // The panel sits over the game; it never blanks it out. A full-viewport
    // frame would also swallow every click outside the card.
    openInlinePicker(pickerUrl(API));
    const style = document.querySelector("iframe")?.getAttribute("style") ?? "";
    expect(style).toContain("width:min(360px,92vw)");
    expect(style).not.toContain("width:100%");
    expect(style).not.toContain("height:100vh");
  });

  it("survives a double close", () => {
    const picker = openInlinePicker(pickerUrl(API));
    picker?.close();
    expect(() => picker?.close()).not.toThrow();
  });

  it("asks the picker for its inline layout", () => {
    openInlinePicker(pickerUrl(API));
    const src = document.querySelector("iframe")?.getAttribute("src") ?? "";
    expect(new URL(src, window.location.href).searchParams.get("inline")).toBe("1");
  });

  describe("fitting the card", () => {
    function frame(): HTMLIFrameElement {
      const el = document.querySelector("iframe");
      if (!el) throw new Error("no frame");
      return el;
    }
    // jsdom's CSSOM drops `min()` values, so watch what is set, not what sticks.
    function heights(el = frame()) {
      return vi.spyOn(el.style, "setProperty");
    }
    function postSize(
      data: unknown,
      { source = frame().contentWindow, origin = window.location.origin } = {},
    ) {
      window.dispatchEvent(
        new MessageEvent("message", { data, origin, source: source as Window | null }),
      );
    }

    it("shrinks to the height the picker reports, capped at the default", () => {
      openInlinePicker(pickerUrl(API));
      const set = heights();
      postSize({ type: FRAME_SIZE_TYPE, height: 227.4 });
      expect(set).toHaveBeenCalledWith("height", "min(228px,min(440px,80vh))");
    });

    it("ignores a size from another frame or another origin", () => {
      openInlinePicker(pickerUrl(API));
      const set = heights();
      postSize({ type: FRAME_SIZE_TYPE, height: 200 }, { source: window });
      postSize({ type: FRAME_SIZE_TYPE, height: 200 }, { origin: "https://evil.example" });
      expect(set).not.toHaveBeenCalled();
    });

    it("ignores other messages and nonsense heights", () => {
      openInlinePicker(pickerUrl(API));
      const set = heights();
      postSize({ type: "hallpass:challenge", height: 200 });
      postSize({ type: FRAME_SIZE_TYPE, height: "200px; background:red" });
      postSize({ type: FRAME_SIZE_TYPE, height: 0 });
      postSize({ type: FRAME_SIZE_TYPE, height: 1e9 });
      postSize(null);
      expect(set).not.toHaveBeenCalled();
    });

    it("stops listening once closed", () => {
      const added = vi.spyOn(window, "addEventListener");
      const removed = vi.spyOn(window, "removeEventListener");
      const picker = openInlinePicker(pickerUrl(API));
      const listener = added.mock.calls.find(([type]) => type === "message")?.[1];
      expect(listener).toBeTypeOf("function");
      picker?.close();
      expect(removed).toHaveBeenCalledWith("message", listener);
      added.mockRestore();
      removed.mockRestore();
    });
  });
});

describe("subscribeChallengeSignals", () => {
  function post(data: unknown, origin = window.location.origin) {
    window.dispatchEvent(new MessageEvent("message", { data, origin }));
  }

  it("delivers a signal posted from the API origin", () => {
    const seen = vi.fn();
    const stop = subscribeChallengeSignals(API, seen);

    post({
      type: CHALLENGE_SIGNAL_KEY,
      sent: true,
      challenge: { to: "Ozan", targetScore: 4200, board: "b", game: "g" },
    });

    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].sent).toBe(true);
    expect(seen.mock.calls[0][0].challenge.to).toBe("Ozan");
    stop();
  });

  it("IGNORES a message from any other origin", () => {
    // The listener is attached to the GAME's window, and on a third-party page
    // any frame can post to it. Without this check a hostile ad frame could
    // fake a sent challenge.
    const seen = vi.fn();
    const stop = subscribeChallengeSignals(API, seen);

    post({ type: CHALLENGE_SIGNAL_KEY, sent: true }, "https://evil.example");

    expect(seen).not.toHaveBeenCalled();
    stop();
  });

  it("ignores messages that are not ours", () => {
    const seen = vi.fn();
    const stop = subscribeChallengeSignals(API, seen);

    post({ type: "something-else", sent: true });
    post("a bare string");
    post(null);

    expect(seen).not.toHaveBeenCalled();
    stop();
  });

  it("fires AT MOST ONCE even when two transports land", () => {
    // A browser that delivers both postMessage and the storage event would
    // otherwise settle the game's promise twice.
    const seen = vi.fn();
    const stop = subscribeChallengeSignals(API, seen);

    post({ type: CHALLENGE_SIGNAL_KEY, sent: false, reason: "closed" });
    post({ type: CHALLENGE_SIGNAL_KEY, sent: true });
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CHALLENGE_SIGNAL_KEY,
        newValue: JSON.stringify({ type: CHALLENGE_SIGNAL_KEY, sent: true }),
      }),
    );

    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].reason).toBe("closed");
    stop();
  });

  it("delivers via the storage event too", () => {
    const seen = vi.fn();
    const stop = subscribeChallengeSignals(API, seen);

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CHALLENGE_SIGNAL_KEY,
        newValue: JSON.stringify({ type: CHALLENGE_SIGNAL_KEY, sent: true }),
      }),
    );

    expect(seen).toHaveBeenCalledTimes(1);
    stop();
  });

  it("ignores a storage event under another key, and unparsable JSON", () => {
    const seen = vi.fn();
    const stop = subscribeChallengeSignals(API, seen);

    window.dispatchEvent(
      new StorageEvent("storage", { key: "hp:something", newValue: "{}" }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: CHALLENGE_SIGNAL_KEY, newValue: "{oops" }),
    );

    expect(seen).not.toHaveBeenCalled();
    stop();
  });

  it("stops delivering after unsubscribe", () => {
    const seen = vi.fn();
    const stop = subscribeChallengeSignals(API, seen);
    stop();

    post({ type: CHALLENGE_SIGNAL_KEY, sent: true });

    expect(seen).not.toHaveBeenCalled();
  });

  it("does not let a throwing listener break teardown", () => {
    const stop = subscribeChallengeSignals(API, () => {
      throw new Error("game handler blew up");
    });

    expect(() => post({ type: CHALLENGE_SIGNAL_KEY, sent: true })).not.toThrow();
    stop();
  });
});
