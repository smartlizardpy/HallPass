/**
 * Referral desk actions: the SUPER ADMIN gate runs first, values are bounded, a
 * revoke needs a reason, and the actor comes from the session, never the form.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  setSettings: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${decodeURIComponent(url)}`);
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/auth", () => ({ requireRole: h.requireRole }));
vi.mock("@/app/lib/referrals", () => ({ referralStore: { setSettings: h.setSettings, revoke: h.revoke } }));

import { revokeReferralAction, saveReferralSettingsAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const save = (over: Record<string, string> = {}) => form({ enabled: "on", bonus: "10", cap: "4", ...over });
const revoke = (over: Record<string, string> = {}) => form({ referralId: "7", reason: "Duplicate accounts", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({ email: "owner@hallpass", role: "super_admin", playerId: "g-owner" });
  h.setSettings.mockResolvedValue(true);
  h.revoke.mockResolvedValue(true);
});

describe("the role gate", () => {
  it("asks for super_admin before reading or writing anything", async () => {
    h.requireRole.mockRejectedValue(new Error("NEXT_REDIRECT /dashboard"));
    await expect(saveReferralSettingsAction(save())).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
    await expect(revokeReferralAction(revoke())).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
    expect(h.requireRole).toHaveBeenCalledWith("super_admin");
    expect(h.setSettings).not.toHaveBeenCalled();
    expect(h.revoke).not.toHaveBeenCalled();
  });
});

describe("saveReferralSettingsAction", () => {
  it("saves with the session's email as actor and reports success", async () => {
    await expect(saveReferralSettingsAction(save({ actorEmail: "forged@evil" }))).rejects.toThrow(/ok=.*Saved/);
    expect(h.setSettings).toHaveBeenCalledWith({ enabled: true, bonus: 10, cap: 4, actorEmail: "owner@hallpass" });
  });
  it("an unticked box switches referrals off", async () => {
    const f = save();
    f.delete("enabled");
    await expect(saveReferralSettingsAction(f)).rejects.toThrow(/Saved: referrals off/);
    expect(h.setSettings).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
  it("refuses out-of-range and non-numeric values without touching the store", async () => {
    for (const bad of [{ bonus: "101" }, { bonus: "-1" }, { bonus: "x" }, { cap: "21" }, { cap: "" }, { cap: "1.5" }]) {
      await expect(saveReferralSettingsAction(save(bad))).rejects.toThrow(/error=/);
    }
    expect(h.setSettings).not.toHaveBeenCalled();
  });
  it("says so when the database fails", async () => {
    h.setSettings.mockRejectedValue(new Error("boom"));
    await expect(saveReferralSettingsAction(save())).rejects.toThrow(/error=.*052_referrals/);
  });
});

describe("revokeReferralAction", () => {
  it("revokes with a reason and the session's email", async () => {
    await expect(revokeReferralAction(revoke())).rejects.toThrow(/ok=.*Referral #7 revoked/);
    expect(h.revoke).toHaveBeenCalledWith({ referralId: 7, actorEmail: "owner@hallpass", reason: "Duplicate accounts" });
  });
  it("needs a reason and a real id", async () => {
    await expect(revokeReferralAction(revoke({ reason: "  " }))).rejects.toThrow(/error=.*reason/);
    await expect(revokeReferralAction(revoke({ referralId: "abc" }))).rejects.toThrow(/error=.*not valid/);
    await expect(revokeReferralAction(revoke({ reason: "x".repeat(501) }))).rejects.toThrow(/too long/);
    expect(h.revoke).not.toHaveBeenCalled();
  });
  it("reports a referral that was not rewarded", async () => {
    h.revoke.mockResolvedValue(false);
    await expect(revokeReferralAction(revoke())).rejects.toThrow(/error=.*not currently rewarded/);
  });
});
