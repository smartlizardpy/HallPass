import { describe, expect, it } from "vitest";
import { pickSurprise } from "./surprise";

const GAMES = ["alpha", "bravo", "charlie", "delta"];

/** Deterministic RNG returning each value in turn, then repeating the last. */
function rng(...values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe("pickSurprise", () => {
  it("returns null for an empty catalogue", () => {
    expect(pickSurprise([])).toBeNull();
  });

  it("indexes the pool with the injected RNG", () => {
    expect(pickSurprise(GAMES, { random: rng(0) })).toBe("alpha");
    expect(pickSurprise(GAMES, { random: rng(0.99) })).toBe("delta");
  });

  it("never returns the current game", () => {
    for (const slug of GAMES) {
      for (let i = 0; i < 10; i++) {
        expect(pickSurprise(GAMES, { exclude: slug })).not.toBe(slug);
      }
    }
  });

  it("never repeats the previous pick", () => {
    for (let i = 0; i < 20; i++) {
      expect(pickSurprise(GAMES, { last: "charlie" })).not.toBe("charlie");
    }
  });

  it("excludes both the current game and the previous pick when it can", () => {
    const got = new Set<string>();
    for (let i = 0; i < 40; i++) {
      got.add(pickSurprise(GAMES, { exclude: "alpha", last: "bravo" })!);
    }
    expect(got).toEqual(new Set(["charlie", "delta"]));
  });

  // The degradation ladder — the reason the button never goes dead on a small
  // catalogue. Each case removes one more escape route than the last.
  it("drops the `last` filter before returning nothing", () => {
    // Only two games: excluding the current one AND the last pick empties the
    // pool, so `last` is relaxed and the remaining game is returned.
    expect(pickSurprise(["alpha", "bravo"], { exclude: "alpha", last: "bravo" })).toBe(
      "bravo",
    );
  });

  it("drops the `exclude` filter rather than returning null", () => {
    // A one-game catalogue can only ever return that game.
    expect(pickSurprise(["alpha"], { exclude: "alpha" })).toBe("alpha");
  });

  it("survives an RNG that returns out-of-range or non-finite values", () => {
    expect(GAMES).toContain(pickSurprise(GAMES, { random: rng(1) }));
    expect(GAMES).toContain(pickSurprise(GAMES, { random: rng(NaN) }));
    expect(GAMES).toContain(pickSurprise(GAMES, { random: rng(-1) }));
  });

  it("spreads across the catalogue with the real RNG", () => {
    const got = new Set<string>();
    for (let i = 0; i < 200; i++) got.add(pickSurprise(GAMES)!);
    expect(got.size).toBe(GAMES.length);
  });
});
