import { describe, expect, it } from "vitest";
import { RECENT_AUTH_SECONDS } from "./config";
import { isRecentAuth } from "./recent-auth";

const NOW = 1_700_000_000_000;

describe("isRecentAuth", () => {
  it("accepts a fresh sign-in", () => {
    expect(isRecentAuth(NOW - 1000, NOW)).toBe(true);
  });
  it("accepts exactly at the edge, refuses just past it", () => {
    expect(isRecentAuth(NOW - RECENT_AUTH_SECONDS * 1000, NOW)).toBe(true);
    expect(isRecentAuth(NOW - RECENT_AUTH_SECONDS * 1000 - 1, NOW)).toBe(false);
  });
  it("refuses a missing, non-numeric or future stamp", () => {
    expect(isRecentAuth(undefined, NOW)).toBe(false);
    expect(isRecentAuth(Number.NaN, NOW)).toBe(false);
    expect(isRecentAuth(NOW + 60_000, NOW)).toBe(false);
  });
});
