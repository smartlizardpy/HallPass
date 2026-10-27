import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  mode: "on",
  allowed: true,
  configured: true,
  username: "ozan" as string | null,
  setCredential: vi.fn(),
  deleteCredential: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@/app/lib/auth", () => ({ auth: h.auth, signIn: vi.fn() }));
vi.mock("@/app/lib/db", () => ({ sql: async () => [{ username: h.username }] }));
vi.mock("@/app/lib/boardpass/flag", () => ({
  getBoardPassMode: async () => h.mode,
  boardPassAllowedFor: async () => h.allowed,
}));
vi.mock("@/app/lib/boardpass/credentials", () => ({
  setCredential: h.setCredential,
  deleteCredential: h.deleteCredential,
  revokeParticipantsForPlayer: h.revoke,
}));
vi.mock("@/app/lib/boardpass/pin", async () => {
  const real = await vi.importActual<typeof import("@/app/lib/boardpass/pin")>("@/app/lib/boardpass/pin");
  return { ...real, isPinConfigured: () => h.configured, hashPin: async () => "hash" };
});

import { disableBoardPass, saveBoardPassPin, signOutAllBoards } from "./boardpass-actions";

beforeEach(() => {
  vi.clearAllMocks();
  h.mode = "on"; h.allowed = true; h.configured = true; h.username = "ozan";
  h.auth.mockResolvedValue({ user: { playerId: "p1", authAt: Date.now() } });
});

describe("BoardPass account actions", () => {
  it("saves a good PIN", async () => {
    expect(await saveBoardPassPin("739105", "739105")).toEqual({ ok: true });
    expect(h.setCredential).toHaveBeenCalledWith("p1", "hash");
  });
  it("needs a Google session", async () => {
    h.auth.mockResolvedValue(null);
    expect(await saveBoardPassPin("739105", "739105")).toEqual({ ok: false, error: "signed-out" });
  });
  it("a stale sign-in asks to re-authenticate, for every action", async () => {
    h.auth.mockResolvedValue({ user: { playerId: "p1", authAt: Date.now() - 3_600_000 } });
    for (const call of [() => saveBoardPassPin("739105", "739105"), disableBoardPass, signOutAllBoards]) {
      expect(await call()).toEqual({ ok: false, error: "reauth" });
    }
    expect(h.setCredential).not.toHaveBeenCalled();
    expect(h.deleteCredential).not.toHaveBeenCalled();
  });
  it("a token with no authAt is not recent", async () => {
    h.auth.mockResolvedValue({ user: { playerId: "p1" } });
    expect(await disableBoardPass()).toEqual({ ok: false, error: "reauth" });
  });
  it("rejects bad, weak and mismatched PINs", async () => {
    expect(await saveBoardPassPin("12", "12")).toMatchObject({ error: "invalid-pin" });
    expect(await saveBoardPassPin("123456", "123456")).toMatchObject({ error: "weak-pin" });
    expect(await saveBoardPassPin("739105", "739106")).toMatchObject({ error: "mismatch" });
    expect(h.setCredential).not.toHaveBeenCalled();
  });
  it("needs a username first", async () => {
    h.username = null;
    expect(await saveBoardPassPin("739105", "739105")).toMatchObject({ error: "no-username" });
  });
  it("is unavailable when off, not allowed, or the pepper is missing", async () => {
    h.mode = "off";
    expect(await saveBoardPassPin("739105", "739105")).toMatchObject({ error: "unavailable" });
    h.mode = "on"; h.allowed = false;
    expect(await disableBoardPass()).toMatchObject({ error: "unavailable" });
    h.allowed = true; h.configured = false;
    expect(await signOutAllBoards()).toMatchObject({ error: "unavailable" });
  });
  it("disable and sign-out-all work with a recent sign-in", async () => {
    expect(await disableBoardPass()).toEqual({ ok: true });
    expect(await signOutAllBoards()).toEqual({ ok: true });
    expect(h.deleteCredential).toHaveBeenCalledWith("p1");
    expect(h.revoke).toHaveBeenCalledWith("p1");
  });
});
