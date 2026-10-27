import { describe, expect, it } from "vitest";
import { hashSessionToken, isWellFormedToken, newSessionToken, sessionCookieOptions } from "./token";

describe("session token", () => {
  it("is 43 chars of base64url and unique", () => {
    const a = newSessionToken();
    expect(a).toHaveLength(43);
    expect(isWellFormedToken(a)).toBe(true);
    expect(newSessionToken()).not.toBe(a);
  });
  it("hashes to a stable 64-char hex digest that is not the token", () => {
    const t = newSessionToken();
    expect(hashSessionToken(t)).toBe(hashSessionToken(t));
    expect(hashSessionToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(t)).not.toContain(t);
  });
  it("rejects malformed tokens", () => {
    for (const bad of ["", "short", "a".repeat(44), "!".repeat(43), 5, null, undefined]) {
      expect(isWellFormedToken(bad)).toBe(false);
    }
  });
  it("sets an HttpOnly, Lax, site-wide cookie", () => {
    const o = sessionCookieOptions();
    expect(o).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });
});
