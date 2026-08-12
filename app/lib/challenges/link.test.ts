import { describe, expect, it } from "vitest";
import { FRIEND_CODE_ALPHABET, normalizeFriendCode } from "@/app/lib/username";
import {
  LINK_CODE_LENGTH,
  challengeLinkPath,
  generateLinkCode,
  isValidLinkCode,
  linkUnavailableReason,
  normalizeLinkCode,
} from "./link";

describe("generateLinkCode", () => {
  it("produces a code of the documented length from the shared alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateLinkCode();
      expect(code).toHaveLength(LINK_CODE_LENGTH);
      expect([...code].every((c) => FRIEND_CODE_ALPHABET.includes(c))).toBe(true);
    }
  });

  it("is longer than a friend code, because the route is public", () => {
    // Not a style preference — the header argues it, so the test pins it.
    expect(LINK_CODE_LENGTH).toBeGreaterThan(8);
  });

  it("never emits a vowel, so a code cannot spell a word", () => {
    const codes = Array.from({ length: 200 }, generateLinkCode).join("");
    for (const vowel of ["A", "E", "I", "O", "U"]) {
      expect(codes).not.toContain(vowel);
    }
  });

  it("does not repeat itself across a run", () => {
    const seen = new Set(Array.from({ length: 500 }, generateLinkCode));
    expect(seen.size).toBe(500);
  });

  it("always round-trips through its own normaliser", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateLinkCode();
      expect(normalizeLinkCode(code)).toBe(code);
      expect(isValidLinkCode(code)).toBe(true);
    }
  });
});

describe("normalizeLinkCode", () => {
  it("uppercases and folds the confusable characters", () => {
    // O→0, I→1, L→1, S→5, B→8, Z→2.
    expect(normalizeLinkCode("oilsbz")).toBe("011582");
  });

  it("drops separators a person might type", () => {
    expect(normalizeLinkCode("CDF-GHJ KMN_P")).toBe("CDFGHJKMNP");
  });

  it("drops anything outside the alphabet rather than rejecting the lot", () => {
    expect(normalizeLinkCode("CD/F?GH")).toBe("CDFGH");
  });

  it("returns empty for input with nothing usable in it", () => {
    expect(normalizeLinkCode("")).toBe("");
    expect(normalizeLinkCode("!!!")).toBe("");
    // `A`, `E` and `U` are not in the alphabet at all.
    expect(normalizeLinkCode("AEU")).toBe("");
  });

  it("tolerates a non-string without throwing", () => {
    expect(normalizeLinkCode(undefined as unknown as string)).toBe("");
    expect(normalizeLinkCode(null as unknown as string)).toBe("");
  });

  /**
   * THE REASON THIS FUNCTION EXISTS AT ALL. `normalizeFriendCode` strips a
   * leading `HP` because that is a friend code's display prefix — but `H` and
   * `P` are both in the alphabet, so a link code beginning `HP` would come out
   * two characters short and could never resolve. This is the regression test
   * for reaching for the wrong normaliser.
   */
  it("keeps a leading HP, which the friend-code normaliser would eat", () => {
    const code = "HPCDFGHJKM";
    expect(normalizeLinkCode(code)).toBe(code);
    expect(normalizeFriendCode(code)).not.toBe(code);
  });
});

describe("isValidLinkCode", () => {
  it("accepts exactly the right length and alphabet", () => {
    expect(isValidLinkCode("CDFGHJKMNP")).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isValidLinkCode("CDFGHJKMN")).toBe(false);
    expect(isValidLinkCode("CDFGHJKMNPQ")).toBe(false);
    expect(isValidLinkCode("")).toBe(false);
  });

  it("rejects characters outside the alphabet, including unfolded ones", () => {
    expect(isValidLinkCode("CDFGHJKMNO")).toBe(false); // O is folded to 0
    expect(isValidLinkCode("cdfghjkmnp")).toBe(false); // lowercase is not canonical
  });
});

describe("challengeLinkPath", () => {
  it("is site-relative so the browser can build a same-origin URL", () => {
    expect(challengeLinkPath("CDFGHJKMNP")).toBe("/c/CDFGHJKMNP");
    expect(challengeLinkPath("CDFGHJKMNP").startsWith("/")).toBe(true);
  });

  it("escapes anything unexpected rather than emitting it raw", () => {
    expect(challengeLinkPath("a/b")).toBe("/c/a%2Fb");
  });
});

describe("linkUnavailableReason", () => {
  it("reports a missing link", () => {
    expect(linkUnavailableReason(null)).toBe("missing");
    expect(linkUnavailableReason(undefined)).toBe("missing");
  });

  it("reports a revoked link", () => {
    expect(linkUnavailableReason({ revokedAt: "2026-01-01T00:00:00.000Z" })).toBe(
      "revoked",
    );
  });

  it("passes a live link", () => {
    expect(linkUnavailableReason({ revokedAt: null })).toBeNull();
  });
});
