/**
 * The device taste store's pure rules: parsing is tolerant, the record is capped
 * at its most recent games, and a play never mutates what it was given.
 */

import { describe, expect, it } from "vitest";
import { TASTE_CAP, capTaste, parseTaste, serializeTaste, withPlay } from "./taste-store";

describe("parseTaste", () => {
  it("is empty for nothing, garbage, or another version", () => {
    expect(parseTaste(null)).toEqual({});
    expect(parseTaste("not json")).toEqual({});
    expect(parseTaste(JSON.stringify({ v: 2, games: { a: { n: 1, t: 1 } } }))).toEqual({});
    expect(parseTaste(JSON.stringify({ v: 1, games: null }))).toEqual({});
  });

  it("round-trips a record", () => {
    const taste = { a: { n: 3, t: 100 }, b: { n: 1, t: 200 } };
    expect(parseTaste(serializeTaste(taste))).toEqual(taste);
  });

  it("drops entries that are not a positive count and a finite time", () => {
    const raw = JSON.stringify({
      v: 1,
      games: { ok: { n: 2, t: 5 }, zero: { n: 0, t: 5 }, nan: { n: "x", t: 5 }, noTime: { n: 1 }, inf: { n: 1, t: null } },
    });
    expect(Object.keys(parseTaste(raw))).toEqual(["ok"]);
  });

  it("clamps a hand-edited absurd count", () => {
    const raw = JSON.stringify({ v: 1, games: { a: { n: 9e12, t: 1 } } });
    expect(parseTaste(raw).a.n).toBe(10_000);
  });
});

describe("withPlay", () => {
  it("adds a game and counts repeat plays", () => {
    const a = withPlay({}, "snake", 10);
    const b = withPlay(a, "snake", 20);
    expect(b.snake).toEqual({ n: 2, t: 20 });
  });

  it("does not mutate its input", () => {
    const before = { snake: { n: 1, t: 5 } };
    withPlay(before, "snake", 9);
    expect(before.snake).toEqual({ n: 1, t: 5 });
  });

  it("keeps only the most recently played games once over the cap", () => {
    let taste = {};
    for (let i = 0; i < TASTE_CAP + 5; i++) taste = withPlay(taste, `g${i}`, i + 1);
    const slugs = Object.keys(taste);
    expect(slugs).toHaveLength(TASTE_CAP);
    expect(slugs).not.toContain("g0"); // the oldest went first
    expect(slugs).toContain(`g${TASTE_CAP + 4}`);
  });
});

describe("capTaste", () => {
  it("returns the same object when it is already within the cap", () => {
    const t = { a: { n: 1, t: 1 } };
    expect(capTaste(t)).toBe(t);
  });
});
