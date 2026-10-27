import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({
  reserveLogin: vi.fn(),
  reserveAccount: vi.fn(),
  recordSuccess: vi.fn(),
  verify: vi.fn(),
  dummy: vi.fn(),
  allowed: vi.fn(),
  join: vi.fn(),
  create: vi.fn(),
}));
vi.mock("./attempts", () => ({
  reserveLoginAttempt: h.reserveLogin,
  cleanupAttempts: vi.fn(),
}));
vi.mock("./credentials", () => ({
  reserveAccountAttempt: h.reserveAccount,
  recordSuccess: h.recordSuccess,
}));
vi.mock("./pin", async () => {
  const real = await vi.importActual<typeof import("./pin")>("./pin");
  return { ...real, verifyPin: h.verify, dummyVerify: h.dummy };
});
vi.mock("./flag", () => ({ boardPassAllowedFor: h.allowed }));
vi.mock("./sessions", () => ({
  joinSession: h.join,
  createSession: h.create,
  cleanupSessions: vi.fn(),
}));

import { attemptLogin } from "./login";

const base = { username: "ozan", pin: "739105", ipHash: "iphash", tokenHash: null };
const reserved = { playerId: "p1", pinHash: "hash", pinVersion: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  h.reserveLogin.mockResolvedValue(true);
  h.reserveAccount.mockResolvedValue(reserved);
  h.verify.mockResolvedValue(true);
  h.allowed.mockResolvedValue(true);
  h.create.mockResolvedValue({ sessionId: "s", participantId: "part-1" });
  h.join.mockResolvedValue({ ok: true, participantId: "part-2" });
});

describe("attemptLogin", () => {
  it("throttles before doing any account work or hashing", async () => {
    h.reserveLogin.mockResolvedValue(false);
    expect(await attemptLogin(base)).toEqual({ kind: "throttled" });
    expect(h.reserveAccount).not.toHaveBeenCalled();
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.dummy).not.toHaveBeenCalled();
  });

  it("starts a new session on the first player and returns a fresh cookie token", async () => {
    const out = await attemptLogin(base);
    expect(out).toMatchObject({ kind: "ok", participantId: "part-1" });
    expect(out.kind === "ok" && out.newToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.recordSuccess).toHaveBeenCalledWith("p1");
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: "p1", pinVersion: 3 }),
    );
  });

  it("joins the live session when there is one, with no new cookie", async () => {
    const out = await attemptLogin({ ...base, tokenHash: "existing" });
    expect(out).toEqual({ kind: "ok", participantId: "part-2", newToken: null });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("starts a fresh session if the old one expired underneath", async () => {
    h.join.mockResolvedValue({ ok: false, reason: "gone" });
    const out = await attemptLogin({ ...base, tokenHash: "stale" });
    expect(out.kind === "ok" && out.newToken).toBeTruthy();
    expect(h.create).toHaveBeenCalled();
  });

  it("reports duplicate and full only after the PIN was proven", async () => {
    h.join.mockResolvedValue({ ok: false, reason: "duplicate" });
    expect(await attemptLogin({ ...base, tokenHash: "t" })).toEqual({ kind: "duplicate" });
    h.join.mockResolvedValue({ ok: false, reason: "full" });
    expect(await attemptLogin({ ...base, tokenHash: "t" })).toEqual({ kind: "full" });
  });

  describe("every way in that is wrong gives the same answer", () => {
    it("unknown or locked account → invalid, with a dummy hash for equal timing", async () => {
      h.reserveAccount.mockResolvedValue(null);
      expect(await attemptLogin(base)).toEqual({ kind: "invalid" });
      expect(h.dummy).toHaveBeenCalledTimes(1);
      expect(h.verify).not.toHaveBeenCalled();
    });

    it("wrong PIN → invalid, and the counter is not reset", async () => {
      h.verify.mockResolvedValue(false);
      expect(await attemptLogin(base)).toEqual({ kind: "invalid" });
      expect(h.recordSuccess).not.toHaveBeenCalled();
    });

    it.each([
      ["a short PIN", { pin: "123" }],
      ["a non-string PIN", { pin: 739105 }],
      ["a missing username", { username: undefined }],
      ["a username with symbols", { username: "oz an!" }],
    ])("%s → invalid, never reaching the account lookup", async (_n, patch) => {
      expect(await attemptLogin({ ...base, ...patch })).toEqual({ kind: "invalid" });
      expect(h.reserveAccount).not.toHaveBeenCalled();
      expect(h.dummy).toHaveBeenCalledTimes(1);
    });

    it("rollout mode refusing the player → invalid, indistinguishable", async () => {
      h.allowed.mockResolvedValue(false);
      expect(await attemptLogin(base)).toEqual({ kind: "invalid" });
      expect(h.create).not.toHaveBeenCalled();
    });
  });

  it("normalises the username before using it", async () => {
    await attemptLogin({ ...base, username: "  OZAN " });
    expect(h.reserveAccount).toHaveBeenCalledWith("ozan");
    expect(h.reserveLogin).toHaveBeenCalledWith("iphash", "ozan");
  });
});
