import { describe, expect, it } from "vitest";
import { conversionRate, durationLabel, playerMinutes, unfinishedSessions } from "./config";

describe("co-op metrics", () => {
  it("conversion is undefined with no rooms, never 0% or NaN", () => {
    expect(conversionRate(0, 0)).toBeNull();
    expect(conversionRate(4, 1)).toBe(25);
    expect(conversionRate(3, 3)).toBe(100);
    expect(conversionRate(2, 5)).toBe(100);
  });
  it("unfinished sessions never go negative", () => {
    expect(unfinishedSessions(5, 3)).toBe(2);
    expect(unfinishedSessions(2, 3)).toBe(0);
  });
  it("player-minutes rounds player-seconds", () => {
    expect(playerMinutes(0)).toBe(0);
    expect(playerMinutes(600 * 3)).toBe(30);
  });
  it("formats lengths", () => {
    expect(durationLabel(null)).toBe("—");
    expect(durationLabel(-1)).toBe("—");
    expect(durationLabel(NaN)).toBe("—");
    expect(durationLabel(45)).toBe("45s");
    expect(durationLabel(720)).toBe("12m");
    expect(durationLabel(3900)).toBe("1h 05m");
  });
});
