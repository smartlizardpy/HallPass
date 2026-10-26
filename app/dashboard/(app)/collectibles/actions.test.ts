/**
 * Collectibles desk actions: the role gate runs before anything is read or
 * written, reasons are required, the actor comes from the session, the grant key
 * is derived from the page's nonce, and an unknown pack is refused.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  findPlayerForAdmin: vi.fn(),
  adminGrantPack: vi.fn(),
  revokePack: vi.fn(),
  revokePull: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${decodeURIComponent(url)}`);
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/auth", () => ({ requireRole: h.requireRole }));
vi.mock("@/app/lib/collectibles", () => ({
  collectiblesStore: {
    findPlayerForAdmin: h.findPlayerForAdmin,
    adminGrantPack: h.adminGrantPack,
    revokePack: h.revokePack,
    revokePull: h.revokePull,
  },
}));

import { grantPackAction, revokePackAction, revokePullAction } from "./actions";

const NONCE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PACK = "11111111-1111-1111-1111-111111111111";
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const grant = (over: Record<string, string> = {}) =>
  form({ player: "alice", pack: "hpo-standard", reason: "Compensation for a bug", nonce: NONCE, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({ email: "staff@hallpass", role: "super_admin", playerId: "g-staff" });
  h.findPlayerForAdmin.mockResolvedValue({ playerId: "p1", publicId: "pub-1", name: "@alice" });
  h.adminGrantPack.mockResolvedValue({ created: true, pack: { publicId: PACK } });
  h.revokePack.mockResolvedValue(true);
  h.revokePull.mockResolvedValue(true);
});

describe("the role gate", () => {
  it("runs before anything is read or written", async () => {
    h.requireRole.mockRejectedValue(new Error("NEXT_REDIRECT /dashboard/signin"));
    await expect(grantPackAction(grant())).rejects.toThrow(/signin/);
    await expect(revokePackAction(form({ packId: PACK, reason: "x" }))).rejects.toThrow(/signin/);
    await expect(revokePullAction(form({ pullId: "3", reason: "x" }))).rejects.toThrow(/signin/);
    expect(h.findPlayerForAdmin).not.toHaveBeenCalled();
    expect(h.adminGrantPack).not.toHaveBeenCalled();
    expect(h.revokePack).not.toHaveBeenCalled();
    expect(h.revokePull).not.toHaveBeenCalled();
  });
  it("requires super_admin in every action, and writes nothing when the guard redirects", async () => {
    for (const run of [
      () => grantPackAction(grant()),
      () => revokePackAction(form({ packId: PACK, reason: "x" })),
      () => revokePullAction(form({ pullId: "3", reason: "x" })),
    ]) {
      h.requireRole.mockClear();
      await run().catch(() => {});
      expect(h.requireRole).toHaveBeenCalledTimes(1);
      expect(h.requireRole).toHaveBeenCalledWith("super_admin");
    }
    vi.clearAllMocks();
    h.requireRole.mockRejectedValue(new Error("NEXT_REDIRECT /dashboard"));
    await expect(grantPackAction(grant())).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(revokePackAction(form({ packId: PACK, reason: "x" }))).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(revokePullAction(form({ pullId: "3", reason: "x" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(h.findPlayerForAdmin).not.toHaveBeenCalled();
    expect(h.adminGrantPack).not.toHaveBeenCalled();
    expect(h.revokePack).not.toHaveBeenCalled();
    expect(h.revokePull).not.toHaveBeenCalled();
  });
});

describe("grants", () => {
  it("need a reason, and write nothing without one", async () => {
    await expect(grantPackAction(grant({ reason: "   " }))).rejects.toThrow(/Give a reason/);
    expect(h.adminGrantPack).not.toHaveBeenCalled();
  });
  it("refuse an unknown pack, a missing player and a malformed nonce before the database", async () => {
    await expect(grantPackAction(grant({ pack: "nope" }))).rejects.toThrow(/Unknown pack/);
    await expect(grantPackAction(grant({ player: "" }))).rejects.toThrow(/username or a public id/);
    await expect(grantPackAction(grant({ nonce: "x" }))).rejects.toThrow(/expired/);
    expect(h.findPlayerForAdmin).not.toHaveBeenCalled();
  });
  it("say so when no player matches", async () => {
    h.findPlayerForAdmin.mockResolvedValue(null);
    await expect(grantPackAction(grant())).rejects.toThrow(/No player/);
    expect(h.adminGrantPack).not.toHaveBeenCalled();
  });
  it("key the grant on the nonce and take the actor from the session, not the form", async () => {
    await expect(
      grantPackAction(grant({ actorEmail: "forged@evil", actor_email: "forged@evil", email: "forged@evil" })),
    ).rejects.toThrow(/Granted/);
    expect(h.adminGrantPack).toHaveBeenCalledWith(
      expect.objectContaining({
        playerId: "p1",
        packId: "hpo-standard",
        grantKey: `admin:${NONCE}`,
        source: "admin",
        actorEmail: "staff@hallpass",
        reason: "Compensation for a bug",
      }),
    );
  });
  it("report a replayed nonce as already granted", async () => {
    h.adminGrantPack.mockResolvedValue({ created: false, pack: { publicId: PACK } });
    await expect(grantPackAction(grant())).rejects.toThrow(/Already granted/);
  });
  it("turn a store failure into a banner", async () => {
    h.adminGrantPack.mockRejectedValue(new Error("relation does not exist"));
    await expect(grantPackAction(grant())).rejects.toThrow(/Could not grant/);
  });
});

describe("revokes", () => {
  it("need a reason", async () => {
    await expect(revokePackAction(form({ packId: PACK }))).rejects.toThrow(/Give a reason/);
    await expect(revokePullAction(form({ pullId: "3", reason: " " }))).rejects.toThrow(/Give a reason/);
    expect(h.revokePack).not.toHaveBeenCalled();
    expect(h.revokePull).not.toHaveBeenCalled();
  });
  it("reject malformed ids", async () => {
    await expect(revokePackAction(form({ packId: "1; drop", reason: "x" }))).rejects.toThrow(/not valid/);
    await expect(revokePullAction(form({ pullId: "1; drop", reason: "x" }))).rejects.toThrow(/not valid/);
    await expect(revokePullAction(form({ pullId: "0", reason: "x" }))).rejects.toThrow(/not valid/);
    expect(h.revokePack).not.toHaveBeenCalled();
    expect(h.revokePull).not.toHaveBeenCalled();
  });
  it("use the session's email as the actor", async () => {
    await expect(revokePackAction(form({ packId: PACK, reason: "Wrong player", actorEmail: "forged@evil" }))).rejects.toThrow(/revoked/);
    expect(h.revokePack).toHaveBeenCalledWith({ publicId: PACK, actorEmail: "staff@hallpass", reason: "Wrong player" });
    await expect(revokePullAction(form({ pullId: "42", reason: "Exploit", actorEmail: "forged@evil" }))).rejects.toThrow(/revoked/);
    expect(h.revokePull).toHaveBeenCalledWith({ pullId: 42, actorEmail: "staff@hallpass", reason: "Exploit" });
  });
  it("say when nothing changed", async () => {
    h.revokePack.mockResolvedValue(false);
    h.revokePull.mockResolvedValue(false);
    await expect(revokePackAction(form({ packId: PACK, reason: "x" }))).rejects.toThrow(/Nothing changed/);
    await expect(revokePullAction(form({ pullId: "3", reason: "x" }))).rejects.toThrow(/was not changed/);
  });
});
