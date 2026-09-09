// @vitest-environment jsdom

/**
 * Unit tests for the console ring buffer.
 *
 * The behaviour worth pinning down is COST, not content. This module sits on the
 * hot path of every `console.*` call in the app, and the bug it was written
 * against was not a wrong log line — it was a page the browser offered to kill,
 * because each call re-serialised the whole buffer into a synchronous
 * localStorage write. So the assertions below are mostly about how much work a
 * call does: that one entry cannot grow without bound, that a burst of calls
 * costs one write rather than N, that a subscriber which logs cannot recurse,
 * and that a buffer written by an older build is dropped instead of parsed on
 * every load.
 *
 * `getConsoleLogEntries` backs `useSyncExternalStore`, so its reference
 * stability is pinned too: a fresh array per read would spin the Logs page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_STORED_CHARS,
  MAX_TEXT,
  PERSIST_DEBOUNCE_MS,
  clearConsoleLog,
  getConsoleLogEntries,
  initConsoleCapture,
  subscribeConsoleLog,
} from "./console-capture";

const STORAGE_KEY = "hp:console-logs";

// initConsoleCapture patches `console` in place and latches on the window-anchored
// store. Both have to be put back, or each test inherits the previous one's
// wrappers and the patches stack.
const original = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

beforeEach(() => {
  delete window.__hpConsoleStore;
  window.localStorage.clear();
  Object.assign(console, original);
});

afterEach(() => {
  Object.assign(console, original);
  vi.useRealTimers();
});

describe("entry size", () => {
  it("clamps a single oversized argument to MAX_TEXT", () => {
    initConsoleCapture();
    console.log("y".repeat(50_000));

    const [entry] = getConsoleLogEntries();
    expect(entry.text.length).toBeLessThan(MAX_TEXT + 100);
    expect(entry.text).toContain("[+48000 chars]");
  });

  it("clamps a stringified object, not just a string", () => {
    initConsoleCapture();
    console.error({ blob: "z".repeat(50_000) });

    const [entry] = getConsoleLogEntries();
    expect(entry.text.length).toBeLessThan(MAX_TEXT + 100);
  });

  it("keeps a normal line untouched", () => {
    initConsoleCapture();
    console.warn("something went wrong", 42);

    expect(getConsoleLogEntries()[0].text).toBe("something went wrong 42");
  });

  it("caps the buffer length", () => {
    initConsoleCapture();
    for (let i = 0; i < 400; i++) console.log(`line ${i}`);

    const entries = getConsoleLogEntries();
    expect(entries).toHaveLength(300);
    // Oldest are dropped, newest survive.
    expect(entries[entries.length - 1].text).toBe("line 399");
  });
});

describe("persistence cost", () => {
  it("writes once for a burst instead of once per call", () => {
    vi.useFakeTimers();
    initConsoleCapture();
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    for (let i = 0; i < 200; i++) console.log(`burst ${i}`);
    expect(setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    expect(setItem).toHaveBeenCalledTimes(1);

    setItem.mockRestore();
  });

  it("flushes pending entries when the page goes away", () => {
    vi.useFakeTimers();
    initConsoleCapture();
    console.log("last words");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    window.dispatchEvent(new Event("pagehide"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain("last words");
  });

  it("clearConsoleLog writes through immediately", () => {
    vi.useFakeTimers();
    initConsoleCapture();
    console.log("noise");
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);

    clearConsoleLog();
    expect(getConsoleLogEntries()).toHaveLength(0);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("[]");
  });
});

describe("re-entrancy", () => {
  it("does not recurse when a subscriber logs", () => {
    initConsoleCapture();
    let calls = 0;
    subscribeConsoleLog(() => {
      calls++;
      // A subscriber that logs is the loop this guard exists for.
      console.log("from the listener");
    });

    console.log("outer");

    // One notification for the outer call; the nested one is dropped rather
    // than recorded, so it cannot notify again.
    expect(calls).toBe(1);
    expect(getConsoleLogEntries()).toHaveLength(1);
  });
});

describe("snapshot stability", () => {
  it("returns the same reference until the buffer changes", () => {
    initConsoleCapture();
    console.log("one");

    const a = getConsoleLogEntries();
    expect(getConsoleLogEntries()).toBe(a);

    console.log("two");
    const b = getConsoleLogEntries();
    expect(b).not.toBe(a);
    expect(b).toHaveLength(2);
  });
});

describe("hydrate", () => {
  it("restores a sane persisted buffer", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: 7, ts: 1, level: "warn", text: "earlier" }]),
    );
    initConsoleCapture();

    expect(getConsoleLogEntries()[0].text).toBe("earlier");
  });

  it("drops a payload larger than this module could have written", () => {
    window.localStorage.setItem(STORAGE_KEY, "x".repeat(MAX_STORED_CHARS + 1));
    initConsoleCapture();

    expect(getConsoleLogEntries()).toHaveLength(0);
    // And it is gone, so the next load does not pay for it again.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("re-clamps long entries written before the cap existed", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 1, ts: 1, level: "error", text: "q".repeat(20_000) },
      ]),
    );
    initConsoleCapture();

    expect(getConsoleLogEntries()[0].text.length).toBeLessThan(MAX_TEXT + 100);
  });

  it("starts clean on a corrupt payload", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    initConsoleCapture();

    expect(getConsoleLogEntries()).toHaveLength(0);
  });
});
