/**
 * Tests for the request-validation / auth guard. Env-reading functions
 * (`verifyAdminSecret`, `hashIp`) read `process.env` at call time, so each case
 * sets/clears the relevant variable and restores it afterwards.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  sanitizeHandle,
  isValidScore,
  clientKeyFromHeaders,
  verifyAdminSecret,
} from "./guard";
import { GLOBAL_MAX_SCORE } from "./config";

const ORIGINAL_ADMIN_SECRET = process.env.SCOREBOARD_ADMIN_SECRET;

afterEach(() => {
  if (ORIGINAL_ADMIN_SECRET === undefined) {
    delete process.env.SCOREBOARD_ADMIN_SECRET;
  } else {
    process.env.SCOREBOARD_ADMIN_SECRET = ORIGINAL_ADMIN_SECRET;
  }
});

describe("sanitizeHandle", () => {
  it("strips characters outside [A-Za-z0-9 _-]", () => {
    expect(sanitizeHandle("a!b@c#1")).toBe("abc1");
  });

  it("keeps allowed spaces, underscores and hyphens", () => {
    expect(sanitizeHandle("co_op pro-1")).toBe("co_op pro-1");
  });

  it("caps the result at 12 characters", () => {
    expect(sanitizeHandle("ABCDEFGHIJKLMNOP")).toBe("ABCDEFGHIJKL");
    expect(sanitizeHandle("ABCDEFGHIJKLMNOP")).toHaveLength(12);
  });

  it("falls back to ANON for empty, whitespace, or all-illegal input", () => {
    expect(sanitizeHandle("")).toBe("ANON");
    expect(sanitizeHandle("   ")).toBe("ANON");
    expect(sanitizeHandle("™®©")).toBe("ANON");
    expect(sanitizeHandle(undefined)).toBe("ANON");
  });

  it("rejects a non-string by returning ANON", () => {
    expect(sanitizeHandle(123 as unknown as string)).toBe("ANON");
  });
});

describe("isValidScore", () => {
  it("accepts finite, non-negative numbers within the global cap", () => {
    expect(isValidScore(0)).toBe(true);
    expect(isValidScore(500)).toBe(true);
    expect(isValidScore(GLOBAL_MAX_SCORE)).toBe(true);
  });

  it("rejects NaN, Infinity and non-numbers", () => {
    expect(isValidScore(Number.NaN)).toBe(false);
    expect(isValidScore(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidScore("100" as unknown)).toBe(false);
    expect(isValidScore(null)).toBe(false);
    expect(isValidScore(undefined)).toBe(false);
  });

  it("rejects negative scores", () => {
    expect(isValidScore(-1)).toBe(false);
  });

  it("rejects scores over the global cap", () => {
    expect(isValidScore(GLOBAL_MAX_SCORE + 1)).toBe(false);
  });

  it("honours a tighter per-board maxScore", () => {
    expect(isValidScore(100, 100)).toBe(true);
    expect(isValidScore(101, 100)).toBe(false);
  });

  it("falls back to the global cap when maxScore is null/undefined", () => {
    expect(isValidScore(GLOBAL_MAX_SCORE, null)).toBe(true);
    expect(isValidScore(GLOBAL_MAX_SCORE + 1, null)).toBe(false);
  });
});

describe("clientKeyFromHeaders", () => {
  it("uses the first x-forwarded-for hop", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
    expect(clientKeyFromHeaders(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.23" });
    expect(clientKeyFromHeaders(headers)).toBe("198.51.100.23");
  });

  it("returns 'unknown' when no client headers are present", () => {
    expect(clientKeyFromHeaders(new Headers())).toBe("unknown");
  });

  it("ignores an empty x-forwarded-for and uses x-real-ip", () => {
    const headers = new Headers({ "x-forwarded-for": "", "x-real-ip": "10.0.0.1" });
    expect(clientKeyFromHeaders(headers)).toBe("10.0.0.1");
  });
});

describe("verifyAdminSecret", () => {
  it("returns 'unconfigured' when no secret is set", () => {
    delete process.env.SCOREBOARD_ADMIN_SECRET;
    expect(verifyAdminSecret(new Headers())).toBe("unconfigured");
  });

  it("returns 'unauthorized' when no secret is presented", () => {
    process.env.SCOREBOARD_ADMIN_SECRET = "s3cr3t";
    expect(verifyAdminSecret(new Headers())).toBe("unauthorized");
  });

  it("returns 'unauthorized' for a wrong secret", () => {
    process.env.SCOREBOARD_ADMIN_SECRET = "s3cr3t";
    const headers = new Headers({ authorization: "Bearer nope" });
    expect(verifyAdminSecret(headers)).toBe("unauthorized");
  });

  it("accepts the correct secret via Authorization: Bearer", () => {
    process.env.SCOREBOARD_ADMIN_SECRET = "s3cr3t";
    const headers = new Headers({ authorization: "Bearer s3cr3t" });
    expect(verifyAdminSecret(headers)).toBe("ok");
  });

  it("accepts the correct secret via X-Scoreboard-Secret", () => {
    process.env.SCOREBOARD_ADMIN_SECRET = "s3cr3t";
    const headers = new Headers({ "x-scoreboard-secret": "s3cr3t" });
    expect(verifyAdminSecret(headers)).toBe("ok");
  });

  it("tolerates surrounding whitespace in the configured secret", () => {
    process.env.SCOREBOARD_ADMIN_SECRET = "  s3cr3t  ";
    const headers = new Headers({ authorization: "Bearer s3cr3t" });
    expect(verifyAdminSecret(headers)).toBe("ok");
  });
});
