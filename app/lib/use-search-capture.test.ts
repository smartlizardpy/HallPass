/**
 * Tests for the search reporter.
 *
 * The reporter is split out of the hook precisely so this file can exist — the
 * repo has no React testing library and tests hooks by testing what sits
 * underneath them (see `personalization.store.test.ts`). Every decision worth
 * asserting lives here: the trailing edge, de-duplication, and the flush.
 *
 * The bug being locked down is a real one that shipped: capture on every
 * keystroke turned "duskfall" into six events and made the dashboard's top-terms
 * panel a ranking of prefixes. A live reading was `ter 2 / terr 1 / dus 1 /
 * dusk 1`, which is two people typing two words.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSearchReporter,
  type SearchEvent,
  SEARCH_DEBOUNCE_MS,
} from "./use-search-capture";

function setup() {
  const events: SearchEvent[] = [];
  const reporter = createSearchReporter((e) => events.push(e));
  return { events, reporter };
}

/** Type a word one character at a time, as a person does. */
function typeWord(
  reporter: ReturnType<typeof createSearchReporter>,
  word: string,
  results = 1,
  msPerKey = 60,
) {
  for (let i = 1; i <= word.length; i++) {
    reporter.report(word.slice(0, i), results);
    vi.advanceTimersByTime(msPerKey);
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createSearchReporter", () => {
  it("turns a whole typed word into ONE event carrying the final value", () => {
    const { events, reporter } = setup();

    typeWord(reporter, "duskfall");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(events).toEqual([{ query: "duskfall", results: 1 }]);
  });

  it("never reports a prefix the player typed through", () => {
    // The exact failure that produced `dus 1 / dusk 1` in production.
    const { events, reporter } = setup();

    typeWord(reporter, "duskfall");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    const reported = events.map((e) => e.query);
    expect(reported).not.toContain("dus");
    expect(reported).not.toContain("dusk");
    expect(reported).not.toContain("duskfal");
  });

  it("reports two genuinely different searches separately", () => {
    // The reason the dashboard query collapses prefixes rather than just taking
    // the last query per burst: somebody who wanted two things wanted two things.
    const { events, reporter } = setup();

    typeWord(reporter, "terraria");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    typeWord(reporter, "duskfall");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(events.map((e) => e.query)).toEqual(["terraria", "duskfall"]);
  });

  it("carries the match count, including zero", () => {
    // Zero is the whole point of the property — it names a missing game.
    const { events, reporter } = setup();

    typeWord(reporter, "zzzqqq", 0);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(events).toEqual([{ query: "zzzqqq", results: 0 }]);
  });

  it("omits the count entirely when it is not known", () => {
    // Absence must stay distinguishable from zero: the zero-result panel excludes
    // events with no `results`, and treating absence as zero would invent a
    // content gap for every search made from a page that does not filter.
    const { events, reporter } = setup();

    reporter.report("duskfall");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(events).toEqual([{ query: "duskfall" }]);
    expect("results" in events[0]).toBe(false);
  });

  it("ignores anything shorter than the minimum", () => {
    const { events, reporter } = setup();

    reporter.report("du", 5);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);

    expect(events).toEqual([]);
  });

  it("drops a pending word when the player clears the box", () => {
    // Giving up on a search is not a search.
    const { events, reporter } = setup();

    reporter.report("dusk", 1);
    vi.advanceTimersByTime(100);
    reporter.report("", 30);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);

    expect(events).toEqual([]);
  });

  it("does not re-report when only the match count changes", () => {
    // Switching category with a search still in the box re-runs the filter and
    // changes the count. The player did not search again, and counting it twice
    // would inflate every term a browsing player left behind.
    const { events, reporter } = setup();

    reporter.report("dusk", 4);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    reporter.report("dusk", 1);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(events).toHaveLength(1);
    expect(events[0].results).toBe(4);
  });

  it("flushes a half-typed word on unmount", () => {
    // An abandoned search is often a search that found nothing, which is exactly
    // the signal worth keeping.
    const { events, reporter } = setup();

    typeWord(reporter, "duskf", 0);
    reporter.flush();

    expect(events).toEqual([{ query: "duskf", results: 0 }]);
  });

  it("cancel discards instead of sending", () => {
    const { events, reporter } = setup();

    reporter.report("duskfall", 1);
    reporter.cancel();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);

    expect(events).toEqual([]);
  });

  it("collapses a fast typist into one event, not one per keystroke", () => {
    const { events, reporter } = setup();

    // 8 characters at 60ms — well inside the debounce window throughout.
    typeWord(reporter, "duskfall", 3, 60);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(events).toHaveLength(1);
  });
});
