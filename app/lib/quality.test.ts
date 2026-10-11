import { describe, expect, it } from "vitest";
import {
  NEUTRAL_QUALITY,
  W_QUALITY,
  effectiveQuality,
  emptyScores,
  overallQuality,
  qualityBoost,
  toScore,
} from "@/app/lib/quality";

describe("toScore", () => {
  it("accepts whole numbers 1-10, as numbers or form strings", () => {
    expect(toScore(1)).toBe(1);
    expect(toScore("10")).toBe(10);
    expect(toScore(7)).toBe(7);
  });

  it("reads blank as not rated", () => {
    expect(toScore("")).toBeNull();
    expect(toScore(null)).toBeNull();
    expect(toScore(undefined)).toBeNull();
  });

  it("rejects anything outside the scale or not a whole number", () => {
    for (const bad of [0, 11, -3, 5.5, "abc", NaN, Infinity, "5.5", {}]) {
      expect(toScore(bad)).toBeNull();
    }
  });
});

describe("overallQuality", () => {
  it("is null when nothing is rated", () => {
    expect(overallQuality(emptyScores())).toBeNull();
    expect(overallQuality({})).toBeNull();
  });

  it("averages only the criteria that are rated", () => {
    expect(overallQuality({ gameplay: 8, sound: 4 })).toBe(6);
    expect(overallQuality({ gameplay: 9, visuals: 8, sound: 7, polish: 6, fun: 10 })).toBe(8);
  });

  it("rounds to one decimal", () => {
    expect(overallQuality({ gameplay: 7, visuals: 7, sound: 8 })).toBe(7.3);
  });

  it("ignores values that are not valid scores", () => {
    expect(overallQuality({ gameplay: 20, visuals: 6 })).toBe(6);
  });
});

describe("qualityBoost", () => {
  it("is zero for an unrated game and for a neutral one", () => {
    expect(qualityBoost(null)).toBe(0);
    expect(qualityBoost(undefined)).toBe(0);
    expect(qualityBoost(NEUTRAL_QUALITY)).toBeCloseTo(0);
  });

  it("rises with quality and is symmetric at the extremes", () => {
    expect(qualityBoost(10)).toBeCloseTo(W_QUALITY);
    expect(qualityBoost(1)).toBeCloseTo(-W_QUALITY);
    expect(qualityBoost(8)).toBeGreaterThan(qualityBoost(6));
  });

  it("is bounded even for out-of-range input", () => {
    expect(qualityBoost(99)).toBeCloseTo(W_QUALITY);
    expect(qualityBoost(-99)).toBeCloseTo(-W_QUALITY);
    expect(effectiveQuality(NaN)).toBe(NEUTRAL_QUALITY);
  });
});
