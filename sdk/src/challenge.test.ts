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

  it("treats a RELATIVE api as same-origin", () => {
    // config.ts documents the page origin as `api`'s last resort, so a relative
    // value genuinely does mean same-origin and the inline frame is correct —
    // its cookie really will flow.
    expect(isSameOrigin("")).toBe(true);
    expect(isSameOrigin("/")).toBe(true);
  });

  it("does not throw on a value that barely parses", () => {
    // It resolves against the page and so reads as first-party, which is
    // harmless: whatever it was meant to be, the frame it opens is ours.
    expect(() => isSameOrigin("::::")).not.toThrow();
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
