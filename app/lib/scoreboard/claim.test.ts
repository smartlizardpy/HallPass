/**
 * Tests for the signed claim tokens. Like `guard.test.ts`, every secret is read
 * from `process.env` at CALL time, so each case controls the secret chain
 * explicitly: `beforeEach` wipes all four candidate variables to a clean slate
 * and `afterEach` restores whatever the process started with. `now` is injected
 * everywhere a clock matters, so nothing here depends on wall-clock time.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaimToken, verifyClaimToken, CLAIM_MAX_AGE_MS } from "./claim";

const SECRET_VARS = [
  "SCOREBOARD_CLAIM_SECRET",
  "AUTH_SECRET",
  "SCOREBOARD_ADMIN_SECRET",
  "ADMIN_HTML_PASSWORD",
] as const;

const ORIGINALS: Record<string, string | undefined> = Object.fromEntries(
  SECRET_VARS.map((key) => [key, process.env[key]]),
);

beforeEach(() => {
  // Clean slate: no secret is configured unless a test opts one in.
  for (const key of SECRET_VARS) delete process.env[key];
});

afterEach(() => {
  for (const key of SECRET_VARS) {
    if (ORIGINALS[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINALS[key];
    }
  }
});

describe("createClaimToken / verifyClaimToken round-trip", () => {
  it("mints a token that verifies back to its scoreId and boardId", () => {
    process.env.SCOREBOARD_CLAIM_SECRET = "test-secret";

    const token = createClaimToken(42, "neon-snake");
    expect(token).not.toBeNull();
    expect(verifyClaimToken(token as string)).toEqual({
      scoreId: 42,
      boardId: "neon-snake",
    });
  });

  it("resolves the secret through the AUTH_SECRET fallback in the chain", () => {
    process.env.AUTH_SECRET = "auth-secret";

    const token = createClaimToken(3, "c");
    expect(token).not.toBeNull();
    expect(verifyClaimToken(token as string)).toEqual({ scoreId: 3, boardId: "c" });
  });
});

describe("verifyClaimToken rejection", () => {
  it("rejects a token whose signature belongs to a different payload", () => {
    process.env.SCOREBOARD_CLAIM_SECRET = "test-secret";

    const good = createClaimToken(42, "b") as string;
    const other = createClaimToken(43, "b") as string;
    const forgedSig = other.slice(other.indexOf(".") + 1);
    const tampered = good.slice(0, good.indexOf(".") + 1) + forgedSig;

    expect(verifyClaimToken(tampered)).toBeNull();
  });

  it("rejects a payload swapped under an otherwise-valid signature", () => {
    process.env.SCOREBOARD_CLAIM_SECRET = "test-secret";

    const good = createClaimToken(42, "b") as string;
    const sig = good.slice(good.indexOf(".") + 1);
    const forgedPayload = Buffer.from(
      JSON.stringify({ v: "1", s: 999, b: "b", iat: Math.floor(Date.now() / 1000) }),
      "utf8",
    ).toString("base64url");

    expect(verifyClaimToken(forgedPayload + "." + sig)).toBeNull();
  });

  it("rejects a token minted under a different secret (rotation / cross-env)", () => {
    process.env.SCOREBOARD_CLAIM_SECRET = "secret-A";
    const token = createClaimToken(1, "b") as string;

    process.env.SCOREBOARD_CLAIM_SECRET = "secret-B";
    expect(verifyClaimToken(token)).toBeNull();
  });

  it("never throws and returns null for malformed tokens", () => {
    process.env.SCOREBOARD_CLAIM_SECRET = "test-secret";

    expect(verifyClaimToken("")).toBeNull();
    expect(verifyClaimToken("no-delimiter")).toBeNull();
    expect(verifyClaimToken(".onlysig")).toBeNull();
    expect(verifyClaimToken("onlypayload.")).toBeNull();
    expect(verifyClaimToken("a.b.c")).toBeNull();
    expect(verifyClaimToken(undefined as unknown as string)).toBeNull();
  });
});

describe("claim token payload isolation", () => {
  it("keeps a crafted boardId from forging a different scoreId", () => {
    process.env.SCOREBOARD_CLAIM_SECRET = "test-secret";

    // An attacker-supplied boardId that tries to inject its own scoreId. Because
    // the payload is JSON-then-base64url, the boardId is escaped as a string value
    // and can never shift the parsed scoreId.
    const sneaky = '2","s":2,"b":"';
    const token = createClaimToken(1, sneaky) as string;

    expect(verifyClaimToken(token)).toEqual({ scoreId: 1, boardId: sneaky });
  });

  it("round-trips a boardId containing the '.' delimiter char", () => {
    process.env.SCOREBOARD_CLAIM_SECRET = "test-secret";

    // The single literal "." separates two base64url halves; a "." inside the
    // boardId lives inside the base64url-encoded payload and never collides.
    const token = createClaimToken(5, "a.b.c") as string;
    expect(verifyClaimToken(token)).toEqual({ scoreId: 5, boardId: "a.b.c" });
  });
});

describe("claim token expiry", () => {
  it("accepts up to CLAIM_MAX_AGE_MS and rejects past it (injected clock)", () => {
    process.env.SCOREBOARD_CLAIM_SECRET = "test-secret";

    const issuedAt = 1_000_000_000_000; // a whole-second multiple, so no floor drift
    const token = createClaimToken(7, "b", issuedAt) as string;

    // Fresh, and exactly at the 6h boundary: still valid.
    expect(verifyClaimToken(token, issuedAt + 1000)).toEqual({ scoreId: 7, boardId: "b" });
    expect(verifyClaimToken(token, issuedAt + CLAIM_MAX_AGE_MS)).toEqual({
      scoreId: 7,
      boardId: "b",
    });

    // Just past the window: expired.
    expect(verifyClaimToken(token, issuedAt + CLAIM_MAX_AGE_MS + 1000)).toBeNull();
  });
});

describe("claim feature disabled without a secret", () => {
  it("createClaimToken returns null and verifyClaimToken rejects everything", () => {
    // beforeEach already cleared every candidate secret.
    const token = createClaimToken(1, "b");
    expect(token).toBeNull();

    // Even a well-formed-looking token cannot verify with no secret configured.
    expect(verifyClaimToken("payload.signature")).toBeNull();
  });
});
