/**
 * Tests for the MCP OAuth server's pure rules.
 *
 * These are the assertions that stand between "an MCP client can sign in" and
 * "an authorization code can be handed to somebody else's URL", so they are
 * written as refusals wherever possible: the interesting case is always the one
 * that must NOT be accepted.
 *
 * `isOauthEnabled` reads `process.env` at call time, so those cases set their
 * own environment — the same convention as `mcp/guard.test.ts`.
 */

import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  DEFAULT_CLIENT_NAME,
  MAX_REDIRECT_URIS,
  base64url,
  canonicalResource,
  expiryFrom,
  hashSecret,
  isAllowedRedirectUri,
  isOauthEnabled,
  isRegisteredRedirectUri,
  isValidCodeChallenge,
  mintSecret,
  normalizeClientName,
  resourceMatches,
  validateRedirectUris,
  verifyPkceS256,
} from "./config";

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved.MCP_OAUTH_ENABLED = process.env.MCP_OAUTH_ENABLED;
  delete process.env.MCP_OAUTH_ENABLED;
});

afterEach(() => {
  if (saved.MCP_OAUTH_ENABLED === undefined) delete process.env.MCP_OAUTH_ENABLED;
  else process.env.MCP_OAUTH_ENABLED = saved.MCP_OAUTH_ENABLED;
});

describe("isOauthEnabled", () => {
  it("is off when unset — the surface must not switch itself on", () => {
    expect(isOauthEnabled()).toBe(false);
  });

  it("accepts the usual affirmatives", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on"]) {
      process.env.MCP_OAUTH_ENABLED = value;
      expect(isOauthEnabled()).toBe(true);
    }
  });

  it("treats anything else as off, including 0 and false", () => {
    for (const value of ["0", "false", "off", "no", "", "  ", "maybe"]) {
      process.env.MCP_OAUTH_ENABLED = value;
      expect(isOauthEnabled()).toBe(false);
    }
  });
});

describe("mintSecret / hashSecret", () => {
  it("mints 32 bytes of base64url with no padding", () => {
    const secret = mintSecret(randomBytes);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(secret, "base64url")).toHaveLength(32);
  });

  it("never returns the same secret twice", () => {
    const seen = new Set(Array.from({ length: 64 }, () => mintSecret(randomBytes)));
    expect(seen.size).toBe(64);
  });

  it("stores a digest, never the secret itself", () => {
    const secret = mintSecret(randomBytes);
    const stored = hashSecret(secret);
    expect(stored).toHaveLength(64);
    expect(stored).not.toContain(secret);
    expect(hashSecret(secret)).toBe(stored);
  });
});

describe("PKCE S256", () => {
  /** The RFC 7636 appendix B vector, so the implementation is pinned to the spec. */
  const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  it("verifies the RFC vector", () => {
    expect(verifyPkceS256(VERIFIER, CHALLENGE)).toBe(true);
  });

  it("refuses a verifier that does not produce the challenge", () => {
    expect(verifyPkceS256("a".repeat(43), CHALLENGE)).toBe(false);
  });

  it("refuses a `plain` challenge — the verifier echoed back", () => {
    expect(verifyPkceS256(VERIFIER, VERIFIER)).toBe(false);
  });

  it("refuses a verifier outside the 43–128 band", () => {
    const short = "a".repeat(42);
    const shortChallenge = base64url(createHash("sha256").update(short).digest());
    expect(verifyPkceS256(short, shortChallenge)).toBe(false);
  });

  it("refuses a challenge carrying characters outside base64url", () => {
    expect(isValidCodeChallenge(`${"a".repeat(42)}+`)).toBe(false);
    expect(isValidCodeChallenge(`${"a".repeat(42)}/`)).toBe(false);
    expect(isValidCodeChallenge(`${"a".repeat(42)}=`)).toBe(false);
  });

  it("accepts a freshly generated pair of any legal length", () => {
    for (const size of [32, 48, 64, 96]) {
      const verifier = base64url(randomBytes(size)).slice(0, 128);
      const challenge = base64url(createHash("sha256").update(verifier).digest());
      expect(verifyPkceS256(verifier, challenge)).toBe(true);
    }
  });
});

describe("isAllowedRedirectUri", () => {
  it("accepts https anywhere", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
  });

  it("accepts http on loopback — the native/CLI client case", () => {
    expect(isAllowedRedirectUri("http://127.0.0.1:51234/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:8976/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://[::1]:8976/cb")).toBe(true);
  });

  it("refuses plain http anywhere else — the code would cross the wire bare", () => {
    expect(isAllowedRedirectUri("http://example.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("http://127.0.0.1.evil.com/cb")).toBe(false);
  });

  it("refuses non-http schemes", () => {
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("file:///etc/passwd")).toBe(false);
    expect(isAllowedRedirectUri("data:text/html,hi")).toBe(false);
  });

  it("refuses a fragment — the response appends its own parameters", () => {
    expect(isAllowedRedirectUri("https://example.com/cb#x")).toBe(false);
  });

  it("refuses embedded credentials", () => {
    expect(isAllowedRedirectUri("https://user:pass@example.com/cb")).toBe(false);
  });

  it("refuses anything unparseable", () => {
    expect(isAllowedRedirectUri("not a url")).toBe(false);
    expect(isAllowedRedirectUri("")).toBe(false);
  });
});

describe("validateRedirectUris", () => {
  it("refuses an empty or non-array list", () => {
    expect(validateRedirectUris([]).ok).toBe(false);
    expect(validateRedirectUris(undefined).ok).toBe(false);
    expect(validateRedirectUris("https://example.com/cb").ok).toBe(false);
  });

  it("caps the list", () => {
    const many = Array.from(
      { length: MAX_REDIRECT_URIS + 1 },
      (_, i) => `https://example.com/cb${i}`,
    );
    expect(validateRedirectUris(many).ok).toBe(false);
  });

  it("collapses duplicates and preserves order", () => {
    const result = validateRedirectUris([
      "https://b.example/cb",
      "https://a.example/cb",
      "https://b.example/cb",
    ]);
    expect(result).toEqual({
      ok: true,
      uris: ["https://b.example/cb", "https://a.example/cb"],
    });
  });

  it("keeps the string VERBATIM — a normaliser here breaks exact matching", () => {
    const result = validateRedirectUris(["https://Example.com/CB/"]);
    expect(result).toEqual({ ok: true, uris: ["https://Example.com/CB/"] });
  });

  it("refuses the whole registration when one entry is bad", () => {
    const result = validateRedirectUris([
      "https://good.example/cb",
      "http://bad.example/cb",
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("isRegisteredRedirectUri", () => {
  const registered = ["https://example.com/cb"];

  it("accepts the exact string", () => {
    expect(isRegisteredRedirectUri(registered, "https://example.com/cb")).toBe(true);
  });

  it("refuses a prefix match — the open-redirect hole", () => {
    expect(
      isRegisteredRedirectUri(registered, "https://example.com/cb/../evil"),
    ).toBe(false);
    expect(isRegisteredRedirectUri(registered, "https://example.com/cb2")).toBe(false);
  });

  it("refuses a same-origin path that was never registered", () => {
    expect(isRegisteredRedirectUri(registered, "https://example.com/other")).toBe(false);
  });

  it("refuses a trailing-slash variant", () => {
    expect(isRegisteredRedirectUri(registered, "https://example.com/cb/")).toBe(false);
  });

  it("refuses a PORT difference on a non-loopback host", () => {
    // The loopback exception below must not leak to the public internet.
    expect(isRegisteredRedirectUri(registered, "https://example.com:8443/cb")).toBe(false);
  });
});

describe("isRegisteredRedirectUri — the RFC 8252 §7.3 loopback exception", () => {
  // "The authorization server MUST allow any port to be specified at the time of
  // the request for loopback IP redirect URIs." A native client binds whatever
  // port the OS gives it and cannot know it at registration time.
  const loopback = ["http://127.0.0.1/callback", "http://localhost/callback"];

  it("accepts any port on a registered loopback URI", () => {
    expect(isRegisteredRedirectUri(loopback, "http://127.0.0.1:51234/callback")).toBe(true);
    expect(isRegisteredRedirectUri(loopback, "http://localhost:3118/callback")).toBe(true);
    expect(isRegisteredRedirectUri(loopback, "http://127.0.0.1:1/callback")).toBe(true);
  });

  it("accepts the portless form too, which is the exact match", () => {
    expect(isRegisteredRedirectUri(loopback, "http://127.0.0.1/callback")).toBe(true);
  });

  it("accepts a port when the REGISTERED uri carries one and the request differs", () => {
    // The flexibility runs both ways: a client that registered on one port and
    // came back on another is the same case.
    expect(
      isRegisteredRedirectUri(["http://127.0.0.1:1234/cb"], "http://127.0.0.1:5678/cb"),
    ).toBe(true);
  });

  it("still refuses a different PATH on loopback", () => {
    expect(isRegisteredRedirectUri(loopback, "http://127.0.0.1:51234/evil")).toBe(false);
  });

  it("still refuses a different loopback HOST", () => {
    // 127.0.0.2 is loopback to the OS but is not one of the three names the
    // exception covers, so it gets no leeway.
    expect(isRegisteredRedirectUri(loopback, "http://127.0.0.2:51234/callback")).toBe(false);
  });

  it("does not let a loopback registration match a public host", () => {
    expect(isRegisteredRedirectUri(loopback, "http://evil.example:80/callback")).toBe(false);
    expect(isRegisteredRedirectUri(loopback, "https://localhost.evil.example/callback")).toBe(false);
  });

  it("still refuses a different QUERY on loopback", () => {
    expect(
      isRegisteredRedirectUri(["http://127.0.0.1/cb?a=1"], "http://127.0.0.1:9/cb?a=2"),
    ).toBe(false);
  });

  it("accepts Claude Code's real document against a ported callback", () => {
    // Pinned from the live document at
    // https://claude.ai/oauth/claude-code-client-metadata — this exact pair is
    // what "This application is not registered" was really about.
    const claudeCode = ["http://localhost/callback", "http://127.0.0.1/callback"];
    expect(isRegisteredRedirectUri(claudeCode, "http://localhost:51234/callback")).toBe(true);
    expect(isRegisteredRedirectUri(claudeCode, "http://127.0.0.1:3118/callback")).toBe(true);
  });
});

describe("normalizeClientName", () => {
  it("names the absence rather than showing a client id", () => {
    expect(normalizeClientName(undefined)).toBe(DEFAULT_CLIENT_NAME);
    expect(normalizeClientName("   ")).toBe(DEFAULT_CLIENT_NAME);
    expect(normalizeClientName(42)).toBe(DEFAULT_CLIENT_NAME);
  });

  it("collapses whitespace and caps the length", () => {
    expect(normalizeClientName("  Claude   Code  ")).toBe("Claude Code");
    expect(normalizeClientName("x".repeat(500))).toHaveLength(120);
  });
});

describe("resource matching", () => {
  it("ignores a trailing slash and host case", () => {
    expect(
      resourceMatches("https://Example.com/api/mcp/", "https://example.com/api/mcp"),
    ).toBe(true);
  });

  it("does not ignore the path", () => {
    expect(
      resourceMatches("https://example.com/api/mcp", "https://example.com/api/other"),
    ).toBe(false);
  });

  it("does not ignore the host", () => {
    expect(
      resourceMatches("https://evil.com/api/mcp", "https://example.com/api/mcp"),
    ).toBe(false);
  });

  it("drops the query and fragment, which carry no audience meaning", () => {
    expect(canonicalResource("https://example.com/api/mcp?x=1#y")).toBe(
      "https://example.com/api/mcp",
    );
  });
});

describe("expiryFrom", () => {
  it("is absolute, and the code window is far shorter than the token's", () => {
    const now = new Date("2026-09-12T12:00:00.000Z");
    expect(expiryFrom(now, AUTH_CODE_TTL_SECONDS).toISOString()).toBe(
      "2026-09-12T12:01:00.000Z",
    );
    expect(expiryFrom(now, ACCESS_TOKEN_TTL_SECONDS).toISOString()).toBe(
      "2026-09-12T20:00:00.000Z",
    );
  });
});
