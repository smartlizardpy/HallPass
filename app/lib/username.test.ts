import { describe, expect, it } from "vitest";
import {
  FRIEND_CODE_ALPHABET,
  confusableSkeleton,
  formatFriendCode,
  isUnfortunateFriendCode,
  isValidFriendCode,
  normalizeFriendCode,
  normalizeUsername,
  validateUsernameFormat,
} from "./username";

describe("normalizeUsername", () => {
  it("lowercases and trims", () => {
    expect(normalizeUsername("  OzAn  ")).toBe("ozan");
  });

  it("NFKC-folds fullwidth and mathematical variants to plain ASCII", () => {
    // These are the forms someone would use to mint a lookalike of a reserved
    // name; folding them means they are rejected as reserved, not accepted as a
    // separate available username.
    expect(normalizeUsername("ａｄｍｉｎ")).toBe("admin");
    expect(normalizeUsername("𝐚𝐝𝐦𝐢𝐧")).toBe("admin");
  });
});

describe("validateUsernameFormat", () => {
  it("accepts ordinary names", () => {
    for (const name of ["ozan", "player_one", "a1b", "x_y_z", "abc123"]) {
      expect(validateUsernameFormat(name)).toEqual({ ok: true, username: name });
    }
  });

  it("normalizes before validating, so mixed case is accepted", () => {
    expect(validateUsernameFormat("  OzAn_99 ")).toEqual({
      ok: true,
      username: "ozan_99",
    });
  });

  it("enforces the length bounds", () => {
    expect(validateUsernameFormat("ab").ok).toBe(false);
    expect(validateUsernameFormat("ab")).toEqual({ ok: false, reason: "too-short" });
    expect(validateUsernameFormat("a".repeat(21))).toEqual({
      ok: false,
      reason: "too-long",
    });
    // Boundaries are inclusive.
    expect(validateUsernameFormat("abc").ok).toBe(true);
    expect(validateUsernameFormat("a".repeat(20)).ok).toBe(true);
  });

  it("rejects anything outside [a-z0-9_]", () => {
    for (const bad of ["oz an", "oz-an", "oz.an", "oz@n", "özan", "oz​an"]) {
      expect(validateUsernameFormat(bad)).toEqual({ ok: false, reason: "charset" });
    }
  });

  it("rejects edge and doubled underscores", () => {
    expect(validateUsernameFormat("_ozan")).toEqual({
      ok: false,
      reason: "edge-underscore",
    });
    expect(validateUsernameFormat("ozan_")).toEqual({
      ok: false,
      reason: "edge-underscore",
    });
    expect(validateUsernameFormat("oz__an")).toEqual({
      ok: false,
      reason: "double-underscore",
    });
  });

  it("rejects all-digit names", () => {
    expect(validateUsernameFormat("12345")).toEqual({
      ok: false,
      reason: "all-digits",
    });
  });

  it("rejects reserved route segments", () => {
    for (const name of ["admin", "dashboard", "play", "api", "offline", "sdk"]) {
      expect(validateUsernameFormat(name)).toEqual({ ok: false, reason: "reserved" });
    }
  });

  it("rejects impersonation targets", () => {
    for (const name of ["hallpass", "moderator", "staff", "official"]) {
      expect(validateUsernameFormat(name)).toEqual({ ok: false, reason: "reserved" });
    }
  });

  it("rejects leetspeak lookalikes of reserved names", () => {
    // The whole point of the skeleton check.
    for (const name of ["4dm1n", "m0d", "h4llp4ss", "5taff", "0fficial"]) {
      expect(validateUsernameFormat(name)).toEqual({ ok: false, reason: "reserved" });
    }
  });

  it("does NOT reject unrelated names that merely skeletonise oddly", () => {
    // Skeleton matching is scoped to the reserved set, not used as a global
    // uniqueness rule — these must stay available.
    expect(validateUsernameFormat("s0ccer").ok).toBe(true);
    expect(validateUsernameFormat("l33t").ok).toBe(true);
  });
});

describe("confusableSkeleton", () => {
  it("folds digits to letters and drops underscores", () => {
    // 1/l/i all collapse to `i`, so `hallpass` skeletonises to `haiipass`.
    expect(confusableSkeleton("4dm1n")).toBe("admin");
    expect(confusableSkeleton("h_a_l_l_p_a_s_s")).toBe("haiipass");
  });

  it("is IDEMPOTENT — the property the reserved check depends on", () => {
    // The check compares skeleton(input) against skeleton(reservedWord). That is
    // only sound if folding a folded string is a no-op; otherwise the two sides
    // could land in different forms and lookalikes would slip through.
    for (const word of ["admin", "hallpass", "4dm1n", "m0d", "l33t", "s0ccer"]) {
      const once = confusableSkeleton(word);
      expect(confusableSkeleton(once)).toBe(once);
    }
  });

  it("maps a leetspeak variant onto the same skeleton as its target", () => {
    expect(confusableSkeleton("4dm1n")).toBe(confusableSkeleton("admin"));
    expect(confusableSkeleton("h4llp4ss")).toBe(confusableSkeleton("hallpass"));
    expect(confusableSkeleton("5taff")).toBe(confusableSkeleton("staff"));
  });
});

describe("friend codes", () => {
  it("has no vowels, so codes cannot spell words", () => {
    for (const vowel of ["A", "E", "I", "O", "U"]) {
      expect(FRIEND_CODE_ALPHABET.includes(vowel)).toBe(false);
    }
  });

  it("has no confusable pairs — exactly one of each survives", () => {
    // If both members of a pair were present, folding on input would be
    // ambiguous and a mistyped code could resolve to a real, different player.
    for (const [a, b] of [
      ["O", "0"],
      ["I", "1"],
      ["L", "1"],
      ["S", "5"],
      ["B", "8"],
      ["Z", "2"],
    ]) {
      const present = [a, b].filter((c) => FRIEND_CODE_ALPHABET.includes(c));
      expect(present).toHaveLength(1);
    }
  });

  it("folds typed confusables to the canonical character", () => {
    // O->0, I->1, L->1, S->5, B->8, Z->2, and 0 is already canonical.
    expect(normalizeFriendCode("OIL SB Z0")).toBe("0115820");
  });

  it("strips the display separators and the HP prefix", () => {
    expect(normalizeFriendCode("HP-7K2Q-9CDF")).toBe("7K2Q9CDF");
    expect(normalizeFriendCode("hp 7k2q 9cdf")).toBe("7K2Q9CDF");
  });

  it("drops characters that are not in the alphabet", () => {
    expect(normalizeFriendCode("7K2Q!!9CDF")).toBe("7K2Q9CDF");
  });

  it("round-trips a displayed code", () => {
    const code = "7K2Q9CDF";
    expect(normalizeFriendCode(formatFriendCode(code))).toBe(code);
  });

  it("validates length and alphabet", () => {
    expect(isValidFriendCode("7K2Q9CDF")).toBe(true);
    expect(isValidFriendCode("7K2Q9CD")).toBe(false); // too short
    expect(isValidFriendCode("7K2Q9CDA")).toBe(false); // 'A' not in alphabet
  });

  it("flags unfortunate consonant clusters for regeneration", () => {
    expect(isUnfortunateFriendCode("77FCK123".slice(0, 8))).toBe(true);
    expect(isUnfortunateFriendCode("7K2Q9CDF")).toBe(false);
  });
});
