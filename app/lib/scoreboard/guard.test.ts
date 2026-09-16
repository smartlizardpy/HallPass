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
import { GENERATED_STEMS, isGeneratedName } from "@/sdk/src/names";

const ORIGINAL_ADMIN_SECRET = process.env.SCOREBOARD_ADMIN_SECRET;
const ORIGINAL_ADMIN_HTML_PASSWORD = process.env.ADMIN_HTML_PASSWORD;

afterEach(() => {
  if (ORIGINAL_ADMIN_SECRET === undefined) {
    delete process.env.SCOREBOARD_ADMIN_SECRET;
  } else {
    process.env.SCOREBOARD_ADMIN_SECRET = ORIGINAL_ADMIN_SECRET;
  }
  if (ORIGINAL_ADMIN_HTML_PASSWORD === undefined) {
    delete process.env.ADMIN_HTML_PASSWORD;
  } else {
    process.env.ADMIN_HTML_PASSWORD = ORIGINAL_ADMIN_HTML_PASSWORD;
  }
});

describe("sanitizeHandle", () => {
  /** Any name the shared list can mint — not one hardcoded stem. */
  const isGenerated = (value: string) => isGeneratedName(value);

  it("strips characters outside [A-Za-z0-9 _#-] but keeps '#'", () => {
    expect(sanitizeHandle("a!b@c#1")).toBe("abc#1");
  });

  it("keeps allowed spaces, underscores and hyphens", () => {
    expect(sanitizeHandle("co_op pro-1")).toBe("co_op pro-1");
  });

  it("passes EVERY generated stem through whole, past the length cap", () => {
    // THE ROUND TRIP THAT MATTERS: the SDK persists this name and resends it on
    // every later score. Truncating it here would rename the player mid-session
    // and split them into two leaderboard rows, since a guest is identified by
    // their handle string. Looping the whole list is the point — a stem one side
    // can mint but the other cannot match is exactly that bug.
    for (const stem of GENERATED_STEMS) {
      const minted = `${stem}#4821`;
      expect(sanitizeHandle(minted)).toBe(minted);
      expect(minted.length).toBeGreaterThan(12);
    }
  });

  it("still caps anything that is not exactly a generated handle", () => {
    expect(sanitizeHandle("SigmaAlphaMale#48210")).toHaveLength(12);
    expect(sanitizeHandle("SigmaAlphaMale")).toHaveLength(12);
    expect(sanitizeHandle("SigmaAlphaMale#abcd")).toHaveLength(12);
    expect(sanitizeHandle(" SigmaAlphaMale#4821 extra")).toHaveLength(12);
  });

  it("caps the result at 12 characters", () => {
    expect(sanitizeHandle("ABCDEFGHIJKLMNOP")).toBe("ABCDEFGHIJKL");
    expect(sanitizeHandle("ABCDEFGHIJKLMNOP")).toHaveLength(12);
  });

  it("falls back to a generated handle for empty, whitespace, or all-illegal input", () => {
    expect(isGenerated(sanitizeHandle(""))).toBe(true);
    expect(isGenerated(sanitizeHandle("   "))).toBe(true);
    expect(isGenerated(sanitizeHandle("™®©"))).toBe(true);
    expect(isGenerated(sanitizeHandle(undefined))).toBe(true);
  });

  it("falls back to a generated handle for a non-string", () => {
    expect(isGenerated(sanitizeHandle(123 as unknown as string))).toBe(true);
  });

  it("mints only from the list the signed-in placeholder draws on", () => {
    // A board must not read as two populations whose only difference is whether
    // the player happened to be signed in.
    for (let i = 0; i < 100; i += 1) {
      const [stem] = sanitizeHandle("").split("#");
      expect(GENERATED_STEMS).toContain(stem);
    }
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
  it("returns 'unconfigured' when neither secret nor admin password is set", () => {
    delete process.env.SCOREBOARD_ADMIN_SECRET;
    delete process.env.ADMIN_HTML_PASSWORD;
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

  it("falls back to ADMIN_HTML_PASSWORD when no dedicated secret is set", () => {
    delete process.env.SCOREBOARD_ADMIN_SECRET;
    process.env.ADMIN_HTML_PASSWORD = "site-admin-pw";
    const headers = new Headers({ authorization: "Bearer site-admin-pw" });
    expect(verifyAdminSecret(headers)).toBe("ok");
  });

  it("prefers SCOREBOARD_ADMIN_SECRET over ADMIN_HTML_PASSWORD when both are set", () => {
    process.env.SCOREBOARD_ADMIN_SECRET = "dedicated";
    process.env.ADMIN_HTML_PASSWORD = "site-admin-pw";
    expect(
      verifyAdminSecret(new Headers({ authorization: "Bearer dedicated" })),
    ).toBe("ok");
    expect(
      verifyAdminSecret(new Headers({ authorization: "Bearer site-admin-pw" })),
    ).toBe("unauthorized");
  });
});
