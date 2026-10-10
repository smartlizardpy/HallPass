/**
 * Signaling tokens: what the server minted verifies, anything else does not,
 * and the secret chain behaves like `scoreboard/claim.ts`'s.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mintSignalToken, signalSecret, verifySignalToken } from "./tokens";

const saved = { p2p: process.env.P2P_SIGNING_SECRET, auth: process.env.AUTH_SECRET };

beforeEach(() => {
  process.env.P2P_SIGNING_SECRET = "test-secret";
  delete process.env.AUTH_SECRET;
});

afterEach(() => {
  process.env.P2P_SIGNING_SECRET = saved.p2p;
  process.env.AUTH_SECRET = saved.auth;
  if (saved.p2p === undefined) delete process.env.P2P_SIGNING_SECRET;
  if (saved.auth === undefined) delete process.env.AUTH_SECRET;
});

describe("signal tokens", () => {
  it("round-trips a minted payload", () => {
    const token = mintSignalToken({ r: "room1", p: "abcdefghijkl", hp: "mnopqrstuvwx" })!;
    expect(verifySignalToken(token)).toEqual({ v: 1, r: "room1", p: "abcdefghijkl", hp: "mnopqrstuvwx" });
  });

  it("rejects a tampered payload or signature", () => {
    const token = mintSignalToken({ r: "room1", p: "abcdefghijkl", hp: "abcdefghijkl" })!;
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ v: 1, r: "room1", p: "zzzzzzzzzzzz", hp: "abcdefghijkl" }),
    ).toString("base64url");
    expect(verifySignalToken(`${forged}.${sig}`)).toBeNull();
    expect(verifySignalToken(`${payload}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(verifySignalToken("garbage")).toBeNull();
    expect(verifySignalToken(42)).toBeNull();
  });

  it("does not verify under a different secret", () => {
    const token = mintSignalToken({ r: "r", p: "abcdefghijkl", hp: "abcdefghijkl" })!;
    process.env.P2P_SIGNING_SECRET = "rotated";
    expect(verifySignalToken(token)).toBeNull();
  });

  it("falls back to AUTH_SECRET, and is off with neither", () => {
    delete process.env.P2P_SIGNING_SECRET;
    process.env.AUTH_SECRET = "auth";
    expect(signalSecret()).toBe("auth");
    delete process.env.AUTH_SECRET;
    expect(signalSecret()).toBeNull();
    expect(mintSignalToken({ r: "r", p: "p", hp: "p" })).toBeNull();
    expect(verifySignalToken("a.b")).toBeNull();
  });
});
