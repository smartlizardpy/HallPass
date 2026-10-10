/**
 * Room codes and peer ids — shared by the SDK and the signaling routes.
 */

import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  derivePeerId,
  generateCode,
  generateSecret,
  isValidPeerId,
  normalizeCode,
  sanitizeName,
} from "./codes";

describe("room codes", () => {
  it("generates 4 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
    expect(CODE_ALPHABET).not.toMatch(/[IO01]/);
  });

  it("normalises what a player types", () => {
    expect(normalizeCode(" k7qx ")).toBe("K7QX");
    expect(normalizeCode("k7-qx")).toBe("K7QX");
    expect(normalizeCode("K7Q")).toBeNull();
    expect(normalizeCode("K0QX")).toBeNull(); // 0 is not in the alphabet
    expect(normalizeCode(1234)).toBeNull();
  });
});

describe("peer ids", () => {
  it("are derived deterministically from the secret", async () => {
    const secret = generateSecret();
    const a = await derivePeerId(secret);
    expect(isValidPeerId(a)).toBe(true);
    expect(await derivePeerId(secret)).toBe(a);
    expect(await derivePeerId(generateSecret())).not.toBe(a);
  });
});

describe("sanitizeName", () => {
  it("strips control and bidi characters, collapses space, caps length", () => {
    expect(sanitizeName("  Ana \n  Lee ")).toBe("Ana Lee");
    expect(sanitizeName("a\u202eb")).toBe("ab");
    expect(sanitizeName("x".repeat(40))).toHaveLength(24);
    expect(sanitizeName("   ")).toBe("Player");
    expect(sanitizeName(undefined, "Guest")).toBe("Guest");
  });
});
