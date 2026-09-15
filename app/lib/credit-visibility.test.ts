/**
 * Tests for the footer's geo-gated credit rule.
 *
 * `isCreditGeoGateEnabled` reads `process.env` at call time, so those cases set
 * their own environment — the same convention as `mcp/oauth/config.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CREDIT_VISIBLE_COUNTRIES,
  isCreditGeoGateEnabled,
  shouldShowRealCredits,
} from "./credit-visibility";

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved.CREDIT_GEO_GATE = process.env.CREDIT_GEO_GATE;
  delete process.env.CREDIT_GEO_GATE;
});

afterEach(() => {
  if (saved.CREDIT_GEO_GATE === undefined) delete process.env.CREDIT_GEO_GATE;
  else process.env.CREDIT_GEO_GATE = saved.CREDIT_GEO_GATE;
});

describe("isCreditGeoGateEnabled", () => {
  it("is on when unset — a fresh deploy gets the gate, not a leak", () => {
    expect(isCreditGeoGateEnabled()).toBe(true);
  });

  it("accepts the usual negatives to turn it off", () => {
    for (const value of ["off", "OFF", "0", "false", "FALSE", "no"]) {
      process.env.CREDIT_GEO_GATE = value;
      expect(isCreditGeoGateEnabled()).toBe(false);
    }
  });

  it("treats anything else as on, including nonsense", () => {
    for (const value of ["1", "true", "on", "yes", "maybe", ""]) {
      process.env.CREDIT_GEO_GATE = value;
      expect(isCreditGeoGateEnabled()).toBe(true);
    }
  });
});

describe("shouldShowRealCredits", () => {
  it("shows real names for every visible country", () => {
    for (const country of CREDIT_VISIBLE_COUNTRIES) {
      expect(shouldShowRealCredits(country)).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(shouldShowRealCredits("gb")).toBe(true);
    expect(shouldShowRealCredits("tr")).toBe(true);
  });

  it("hides real names everywhere else", () => {
    for (const country of ["US", "DE", "FR", "JP"]) {
      expect(shouldShowRealCredits(country)).toBe(false);
    }
  });

  it("fails closed when the country cannot be resolved", () => {
    expect(shouldShowRealCredits(null)).toBe(false);
    expect(shouldShowRealCredits(undefined)).toBe(false);
  });

  it("shows real names to everyone once the gate is switched off", () => {
    process.env.CREDIT_GEO_GATE = "off";
    expect(shouldShowRealCredits("US")).toBe(true);
    expect(shouldShowRealCredits(null)).toBe(true);
  });
});
