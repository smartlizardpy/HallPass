import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PinUnavailableError,
  dummyVerify,
  hashPin,
  isPinConfigured,
  isValidPinFormat,
  isWeakPin,
  verifyPin,
} from "./pin";

const PEPPER = "x".repeat(40);

beforeEach(() => {
  vi.stubEnv("BOARDPASS_PIN_PEPPER", PEPPER);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PIN format", () => {
  it("accepts exactly six digits, leading zeros included", () => {
    expect(isValidPinFormat("048213")).toBe(true);
    expect(isValidPinFormat("000417")).toBe(true);
  });
  it.each(["12345", "1234567", "12a456", "", " 12345", "١٢٣٤٥٦"])("rejects %j", (pin) => {
    expect(isValidPinFormat(pin)).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(isValidPinFormat(123456)).toBe(false);
    expect(isValidPinFormat(null)).toBe(false);
  });
});

describe("weak PIN blocklist", () => {
  it.each([
    "000000", "111111", "123456", "654321", "234567", "012345", "987654",
    "121212", "123123", "112233", "696969",
  ])("blocks %s", (pin) => {
    expect(isWeakPin(pin)).toBe(true);
  });
  it.each(["048213", "739105", "280617"])("allows %s", (pin) => {
    expect(isWeakPin(pin)).toBe(false);
  });
  it("treats a malformed PIN as weak", () => {
    expect(isWeakPin("12")).toBe(true);
  });
});

describe("hash and verify", () => {
  it("round-trips and rejects a wrong PIN", async () => {
    const stored = await hashPin("player-1", "739105");
    expect(await verifyPin("player-1", "739105", stored)).toBe(true);
    expect(await verifyPin("player-1", "739106", stored)).toBe(false);
  });

  it("is bound to the player id", async () => {
    const stored = await hashPin("player-1", "739105");
    expect(await verifyPin("player-2", "739105", stored)).toBe(false);
  });

  it("salts: the same PIN hashes differently each time", async () => {
    const a = await hashPin("player-1", "739105");
    const b = await hashPin("player-1", "739105");
    expect(a).not.toBe(b);
  });

  it("stores a self-describing string and never the PIN", async () => {
    const stored = await hashPin("player-1", "739105");
    expect(stored).toMatch(/^argon2id\$v1\$m=\d+,t=\d+,p=\d+\$[\w-]+\$[\w-]+$/);
    expect(stored).not.toContain("739105");
  });

  it("returns false, not a throw, for a malformed stored string", async () => {
    expect(await verifyPin("p", "739105", "garbage")).toBe(false);
    expect(await verifyPin("p", "739105", "argon2id$v1$m=1,t=1,p=1$AA$AA")).toBe(false);
  });

  it("refuses absurd cost parameters from a corrupt row", async () => {
    const stored = await hashPin("p", "739105");
    const bomb = stored.replace(/m=\d+/, "m=99999999");
    expect(await verifyPin("p", "739105", bomb)).toBe(false);
  });

  it("returns false for a badly formatted PIN without hashing", async () => {
    const stored = await hashPin("p", "739105");
    expect(await verifyPin("p", "73910", stored)).toBe(false);
  });

  it("a different pepper cannot verify an existing hash", async () => {
    const stored = await hashPin("p", "739105");
    vi.stubEnv("BOARDPASS_PIN_PEPPER", "y".repeat(40));
    expect(await verifyPin("p", "739105", stored)).toBe(false);
  });
});

describe("fails closed without a pepper", () => {
  it.each([undefined, "", "too-short"])("pepper %j", async (value) => {
    vi.stubEnv("BOARDPASS_PIN_PEPPER", value as string);
    expect(isPinConfigured()).toBe(false);
    await expect(hashPin("p", "739105")).rejects.toBeInstanceOf(PinUnavailableError);
    await expect(dummyVerify("739105")).rejects.toBeInstanceOf(PinUnavailableError);
  });
  it("is configured with a long pepper", () => {
    expect(isPinConfigured()).toBe(true);
  });
});

describe("dummyVerify", () => {
  it("resolves without throwing for any input", async () => {
    await expect(dummyVerify("739105")).resolves.toBeUndefined();
    await expect(dummyVerify("not-a-pin")).resolves.toBeUndefined();
  });
});
