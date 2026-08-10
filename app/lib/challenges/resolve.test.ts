/**
 * Tests for what it means to beat a challenge.
 *
 * The rule is mirrored by hand into one SQL predicate in `store.ts`, so these
 * are the assertions that make the mirror worth trusting. Ties get the most
 * attention on purpose: `>` becoming `>=` is a one-character "tidy" that
 * silently rewrites who won, and nothing else in the system would notice.
 */

import { describe, expect, it } from "vitest";
import {
  type ResolvableChallenge,
  beats,
  isWithinWindow,
  resolvedBy,
  scoreToBeat,
} from "./resolve";

const NOW = "2026-06-15T12:00:00.000Z";

function challenge(over: Partial<ResolvableChallenge> = {}): ResolvableChallenge {
  return {
    id: 1,
    targetScore: 4200,
    sort: "desc",
    startsAt: null,
    endsAt: null,
    ...over,
  };
}

describe("beats", () => {
  it("needs a higher score on a desc board", () => {
    expect(beats(4201, 4200, "desc")).toBe(true);
    expect(beats(9999, 4200, "desc")).toBe(true);
    expect(beats(4199, 4200, "desc")).toBe(false);
  });

  it("needs a LOWER score on an asc board — time and golf", () => {
    expect(beats(4199, 4200, "asc")).toBe(true);
    expect(beats(1, 4200, "asc")).toBe(true);
    expect(beats(4201, 4200, "asc")).toBe(false);
  });

  it("does NOT count a tie, in either direction", () => {
    // The decision most likely to be "tidied" into >= by someone who reads the
    // line without reading why. A tie leaves the challenge open; the alternative
    // is both players believing they won.
    expect(beats(4200, 4200, "desc")).toBe(false);
    expect(beats(4200, 4200, "asc")).toBe(false);
  });

  it("handles zero and negative scores without special-casing them", () => {
    expect(beats(0, -1, "desc")).toBe(true);
    expect(beats(-5, 0, "asc")).toBe(true);
    expect(beats(0, 0, "desc")).toBe(false);
  });

  it("refuses non-finite input rather than letting NaN decide", () => {
    // NaN comparisons are always false, so this would "work" by accident — but
    // Infinity would not, and an Infinity score beating everything forever is
    // the kind of bug that only shows up in the leaderboard.
    expect(beats(Number.NaN, 4200, "desc")).toBe(false);
    expect(beats(Number.POSITIVE_INFINITY, 4200, "desc")).toBe(false);
    expect(beats(4201, Number.NaN, "desc")).toBe(false);
    expect(beats(Number.NEGATIVE_INFINITY, 4200, "asc")).toBe(false);
  });
});

describe("scoreToBeat", () => {
  it("is the next integer in the winning direction", () => {
    expect(scoreToBeat(4200, "desc")).toBe(4201);
    expect(scoreToBeat(4200, "asc")).toBe(4199);
  });

  it("agrees with beats() — whatever it returns actually wins", () => {
    // The property that matters: the number the UI shows as the goal must be a
    // number the server will accept as a win.
    for (const target of [-3, 0, 1, 4200, 999_999]) {
      for (const sort of ["desc", "asc"] as const) {
        expect(beats(scoreToBeat(target, sort), target, sort)).toBe(true);
      }
    }
  });

  it("returns the SMALLEST winning score — one short does not win", () => {
    for (const sort of ["desc", "asc"] as const) {
      const goal = scoreToBeat(4200, sort);
      const oneShort = sort === "asc" ? goal + 1 : goal - 1;
      expect(beats(oneShort, 4200, sort)).toBe(false);
    }
  });
});

describe("isWithinWindow", () => {
  it("is always inside when both bounds are null — every friend challenge", () => {
    // This is what lets resolution stay kind-agnostic with no special case.
    expect(isWithinWindow({ startsAt: null, endsAt: null }, NOW)).toBe(true);
  });

  it("includes the lower bound and excludes the upper", () => {
    const window = {
      startsAt: "2026-06-01T00:00:00.000Z",
      endsAt: "2026-07-01T00:00:00.000Z",
    };
    expect(isWithinWindow(window, "2026-06-01T00:00:00.000Z")).toBe(true);
    expect(isWithinWindow(window, "2026-06-30T23:59:59.999Z")).toBe(true);
    // Exclusive, so back-to-back monthly challenges never both accept a score.
    expect(isWithinWindow(window, "2026-07-01T00:00:00.000Z")).toBe(false);
    expect(isWithinWindow(window, "2026-05-31T23:59:59.999Z")).toBe(false);
  });

  it("honours a one-sided window", () => {
    expect(isWithinWindow({ startsAt: "2026-01-01T00:00:00Z", endsAt: null }, NOW)).toBe(true);
    expect(isWithinWindow({ startsAt: "2027-01-01T00:00:00Z", endsAt: null }, NOW)).toBe(false);
    expect(isWithinWindow({ startsAt: null, endsAt: "2027-01-01T00:00:00Z" }, NOW)).toBe(true);
    expect(isWithinWindow({ startsAt: null, endsAt: "2026-01-01T00:00:00Z" }, NOW)).toBe(false);
  });

  it("reads a corrupt bound as CLOSED, not as no bound", () => {
    // A challenge that never expires because its end date failed to parse is
    // strictly worse than one that stops working visibly.
    expect(isWithinWindow({ startsAt: "not a date", endsAt: null }, NOW)).toBe(false);
    expect(isWithinWindow({ startsAt: null, endsAt: "not a date" }, NOW)).toBe(false);
    expect(isWithinWindow({ startsAt: null, endsAt: null }, "not a date")).toBe(false);
  });
});

describe("resolvedBy", () => {
  it("returns the ids a score wins, in the order given", () => {
    const won = resolvedBy(
      5000,
      [challenge({ id: 7 }), challenge({ id: 8, targetScore: 9000 }), challenge({ id: 9 })],
      NOW,
    );
    expect(won).toEqual([7, 9]);
  });

  it("returns nothing when the score beats nothing", () => {
    expect(resolvedBy(10, [challenge()], NOW)).toEqual([]);
    expect(resolvedBy(5000, [], NOW)).toEqual([]);
  });

  it("mixes sort directions on the same submission correctly", () => {
    // One game, two boards is exactly why sort lives on the board.
    const won = resolvedBy(
      100,
      [
        challenge({ id: 1, targetScore: 50, sort: "desc" }), // 100 > 50 → win
        challenge({ id: 2, targetScore: 50, sort: "asc" }), // 100 < 50 → no
        challenge({ id: 3, targetScore: 500, sort: "asc" }), // 100 < 500 → win
      ],
      NOW,
    );
    expect(won).toEqual([1, 3]);
  });

  it("skips a good score that lands outside the window", () => {
    const won = resolvedBy(
      9999,
      [
        challenge({ id: 1 }),
        challenge({
          id: 2,
          startsAt: "2026-01-01T00:00:00Z",
          endsAt: "2026-02-01T00:00:00Z",
        }),
      ],
      NOW,
    );
    expect(won).toEqual([1]);
  });

  it("does not care about kind or acceptance — the seam working", () => {
    // Nothing here knows whether a challenge is friend or seasonal, and nothing
    // reads acceptedAt. A seasonal challenge with a live window resolves through
    // this same call with no new branch, which is the whole point.
    const seasonal = challenge({
      id: 42,
      startsAt: "2026-06-01T00:00:00Z",
      endsAt: "2026-07-01T00:00:00Z",
    });
    expect(resolvedBy(9999, [seasonal], NOW)).toEqual([42]);
  });
});
