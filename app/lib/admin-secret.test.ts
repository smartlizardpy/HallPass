/**
 * Tests for the shared secret gate.
 *
 * These pin the properties whose failure is a security bug rather than a broken
 * feature: an unconfigured deploy accepting a caller, a length mismatch throwing
 * instead of answering, and the two header forms staying interchangeable.
 */

import { describe, expect, it } from "vitest";
import {
  presentedSecret,
  sha256Hex,
  timingSafeSecretEqual,
  verifySecret,
} from "./admin-secret";

const HEADER = "x-hallpass-alerts-secret";

describe("timingSafeSecretEqual", () => {
  it("matches identical secrets", () => {
    expect(timingSafeSecretEqual("s3cr3t", "s3cr3t")).toBe(true);
  });

  it("rejects a different secret", () => {
    expect(timingSafeSecretEqual("s3cr3t", "s3cr3T")).toBe(false);
  });

  it("answers rather than throwing on different lengths", () => {
    // The whole reason both sides are hashed first: `timingSafeEqual` throws on
    // unequal buffer lengths, which would turn a wrong-length secret into a 500
    // and into a length oracle.
    expect(timingSafeSecretEqual("short", "a-very-much-longer-secret")).toBe(false);
    expect(timingSafeSecretEqual("", "x")).toBe(false);
  });

  it("hashes to a fixed 64-char digest whatever went in", () => {
    expect(sha256Hex("")).toHaveLength(64);
    expect(sha256Hex("z".repeat(5000))).toHaveLength(64);
  });
});

describe("presentedSecret", () => {
  it("reads Authorization: Bearer", () => {
    expect(presentedSecret(new Headers({ authorization: "Bearer abc" }), HEADER)).toBe(
      "abc",
    );
  });

  it("is case-insensitive about the scheme and tolerates extra space", () => {
    expect(
      presentedSecret(new Headers({ authorization: "  bearer   abc" }), HEADER),
    ).toBe("abc");
  });

  it("reads the named fallback header", () => {
    expect(presentedSecret(new Headers({ [HEADER]: " abc " }), HEADER)).toBe("abc");
  });

  it("ignores a fallback header this surface did not ask for", () => {
    // Each surface names its own header so a leaked credential is traceable.
    expect(presentedSecret(new Headers({ "x-scoreboard-secret": "abc" }), HEADER)).toBe(
      null,
    );
  });

  it("returns null when nothing is presented", () => {
    expect(presentedSecret(new Headers(), HEADER)).toBe(null);
    expect(presentedSecret(new Headers({ authorization: "Bearer   " }), HEADER)).toBe(
      null,
    );
    expect(presentedSecret(new Headers({ authorization: "Basic abc" }), HEADER)).toBe(
      null,
    );
  });
});

describe("verifySecret", () => {
  it("refuses everybody when nothing is configured", () => {
    // Never "ok". A deploy with no secret set must refuse rather than accept —
    // and an empty string is the shape that mistake takes in practice.
    const headers = new Headers({ authorization: "Bearer abc" });
    expect(verifySecret(undefined, headers, HEADER)).toBe("unconfigured");
    expect(verifySecret(null, headers, HEADER)).toBe("unconfigured");
    expect(verifySecret("", headers, HEADER)).toBe("unconfigured");
    expect(verifySecret("   ", headers, HEADER)).toBe("unconfigured");
  });

  it("distinguishes a missing secret from a wrong one", () => {
    expect(verifySecret("abc", new Headers(), HEADER)).toBe("unauthorized");
    expect(
      verifySecret("abc", new Headers({ authorization: "Bearer nope" }), HEADER),
    ).toBe("unauthorized");
  });

  it("accepts the right secret through either header", () => {
    expect(
      verifySecret("abc", new Headers({ authorization: "Bearer abc" }), HEADER),
    ).toBe("ok");
    expect(verifySecret("abc", new Headers({ [HEADER]: "abc" }), HEADER)).toBe("ok");
  });

  it("tolerates surrounding whitespace in the configured secret", () => {
    // An env var pasted into a dashboard picks up spaces more often than not.
    expect(
      verifySecret("  abc  ", new Headers({ authorization: "Bearer abc" }), HEADER),
    ).toBe("ok");
  });
});
