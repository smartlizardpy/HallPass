import { describe, expect, it, vi } from "vitest";
import { copyText, inviteState, progressLabel, readLandingToken, rewardBanner, type MeBody } from "./logic";

const base: MeBody = {
  signedIn: true,
  available: true,
  opensAt: "2026-10-28T00:00:00Z",
  closesAt: "2026-11-03T00:00:00Z",
  rules: { enabled: true, bonus: 10, cap: 4 },
  token: "7CDFGHJKMNPQ",
  pending: 0,
  rewarded: 0,
  candy: 0,
  remaining: 4,
  windowOpen: true,
};

describe("copyText", () => {
  it("uses the async clipboard when it works", async () => {
    const writeText = vi.fn(async () => undefined);
    expect(await copyText("hi", { clipboard: { writeText } })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("hi");
  });
  it("falls back to the legacy route when the async clipboard is refused", async () => {
    const legacy = vi.fn(() => true);
    const clipboard = { writeText: vi.fn(async () => { throw new Error("denied"); }) };
    expect(await copyText("hi", { clipboard, legacy })).toBe("copied");
    expect(legacy).toHaveBeenCalledWith("hi");
  });
  it("asks for a manual copy when everything fails", async () => {
    const clipboard = { writeText: vi.fn(async () => { throw new Error("denied"); }) };
    expect(await copyText("hi", { clipboard, legacy: () => false })).toBe("manual");
    expect(await copyText("hi", { clipboard: null })).toBe("manual");
    expect(await copyText("hi", { legacy: () => { throw new Error("x"); } })).toBe("manual");
  });
});

describe("inviteState", () => {
  it("walks through every state", () => {
    expect(inviteState(null, false).kind).toBe("loading");
    expect(inviteState(null, true).kind).toBe("unavailable");
    expect(inviteState({ ...base, signedIn: false }, false).kind).toBe("signed-out");
    expect(inviteState({ ...base, available: false }, false).kind).toBe("unavailable");
    expect(inviteState({ ...base, rules: { ...base.rules, enabled: false } }, false).kind).toBe("paused");
    expect(inviteState({ ...base, windowOpen: false }, false).kind).toBe("closed");
    expect(inviteState(base, false)).toEqual({ kind: "ready", capReached: false });
  });
  it("keeps the link usable at the cap but says so", () => {
    expect(inviteState({ ...base, rewarded: 4, remaining: 0 }, false)).toEqual({ kind: "ready", capReached: true });
  });
});

describe("rewardBanner", () => {
  it("is quiet when nothing is new", () => {
    expect(rewardBanner(base, null)).toBeNull();
    expect(rewardBanner({ ...base, rewarded: 1, candy: 10 }, { rewarded: 1, candy: 10 })).toBeNull();
  });
  it("names the real award, not a constant", () => {
    const r = rewardBanner({ ...base, rewarded: 1, candy: 7 }, null);
    expect(r?.text).toBe("Your friend joined the Fright! +7 candy!");
    expect(r?.seen).toEqual({ rewarded: 1, candy: 7 });
  });
  it("sums several at once", () => {
    expect(rewardBanner({ ...base, rewarded: 3, candy: 30 }, { rewarded: 1, candy: 10 })?.text).toBe("2 friends joined the Fright! +20 candy!");
  });
});

describe("progress and landing", () => {
  it("never shows more than the cap", () => {
    expect(progressLabel(2, 4)).toBe("2 / 4 friends rewarded");
    expect(progressLabel(5, 4)).toBe("4 / 4 friends rewarded");
  });
  it("reads the token and strips only it from the URL", () => {
    expect(readLandingToken("?fref=ABC&x=1", "fref")).toEqual({ token: "ABC", cleaned: "?x=1" });
    expect(readLandingToken("?fref=ABC", "fref")).toEqual({ token: "ABC", cleaned: "" });
    expect(readLandingToken("", "fref")).toEqual({ token: null, cleaned: "" });
  });
});
