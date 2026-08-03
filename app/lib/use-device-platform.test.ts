/**
 * Unit tests for the PURE half of `use-device-platform.ts` — `playsOn`. The hook
 * itself needs a DOM and `matchMedia`, and is not covered here.
 *
 * The behaviour worth pinning down is the THIRD state. `playsOn` returns `null`
 * for an untagged game, and every caller leans on that to render nothing at all.
 * If it ever collapsed to a boolean, an untagged catalogue would start badging and
 * re-sorting itself on guesses — the exact failure the optional field exists to
 * prevent — and no type error would catch it, because `boolean | null` still
 * type-checks as truthy/falsy at every call site.
 */

import { describe, expect, it } from "vitest";

import type { Game } from "./games";
import { playsOn } from "./use-device-platform";

/** A minimal `Game`; only `platform` matters to `playsOn`. */
function game(platform?: Game["platform"]): Game {
  return {
    slug: "test-game",
    title: "Test Game",
    tagline: "",
    description: "",
    category: "Arcade",
    tags: [],
    gradient: ["#000000", "#ffffff"],
    accent: "#ffffff",
    art: "void",
    platform,
  };
}

describe("playsOn", () => {
  it("returns null for an untagged game on either device", () => {
    expect(playsOn(game(), "mobile")).toBeNull();
    expect(playsOn(game(), "desktop")).toBeNull();
  });

  it("matches a single-platform game to its own device only", () => {
    expect(playsOn(game("desktop"), "desktop")).toBe(true);
    expect(playsOn(game("desktop"), "mobile")).toBe(false);
    expect(playsOn(game("mobile"), "mobile")).toBe(true);
    expect(playsOn(game("mobile"), "desktop")).toBe(false);
  });

  it("accepts a `both` game everywhere", () => {
    expect(playsOn(game("both"), "desktop")).toBe(true);
    expect(playsOn(game("both"), "mobile")).toBe(true);
  });

  it("distinguishes unknown from unplayable", () => {
    // The distinction the whole design rests on: `null` and `false` are both
    // falsy, so a caller writing `if (!playsOn(...))` would badge untagged games
    // as unplayable. They must be compared explicitly.
    expect(playsOn(game(), "mobile")).not.toBe(false);
    expect(playsOn(game("desktop"), "mobile")).toBe(false);
  });
});
