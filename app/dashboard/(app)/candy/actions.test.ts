/**
 * Candy desk actions: the SUPER ADMIN gate runs before anything is read or
 * written, values are bounded 0 to 40, reasons are required, the actor comes from
 * the session, and the game filter survives the redirect.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  setBoardCandy: vi.fn(),
  revokeCredit: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${decodeURIComponent(url)}`);
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/auth", () => ({ requireRole: h.requireRole }));
vi.mock("@/app/lib/candy", async () => {
  const { CANDY_FRIGHT_FEST_2026 } = await import("@/app/lib/candy/fright-fest-2026");
  return { CANDY: CANDY_FRIGHT_FEST_2026, candyStore: { setBoardCandy: h.setBoardCandy, revokeCredit: h.revokeCredit } };
});

import { revokeCreditAction, setCandyValueAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const set = (over: Record<string, string> = {}) => form({ boardId: "duskfall-score", candy: "12", game: "last-bell", ...over });
const revoke = (over: Record<string, string> = {}) => form({ ledgerId: "9", reason: "Farmed with a script", game: "last-bell", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({ email: "owner@hallpass", role: "super_admin", playerId: "g-owner" });
  h.setBoardCandy.mockResolvedValue("changed");
  h.revokeCredit.mockResolvedValue(true);
});

describe("the role gate", () => {
  it("asks for super_admin, and runs before anything is read or written", async () => {
    h.requireRole.mockRejectedValue(new Error("NEXT_REDIRECT /dashboard"));
    await expect(setCandyValueAction(set())).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
    await expect(revokeCreditAction(revoke())).rejects.toThrow(/NEXT_REDIRECT \/dashboard/);
    expect(h.requireRole).toHaveBeenCalledWith("super_admin");
    expect(h.setBoardCandy).not.toHaveBeenCalled();
    expect(h.revokeCredit).not.toHaveBeenCalled();
  });

  it("is the first thing each action does, even with a form that would otherwise fail validation", async () => {
    h.requireRole.mockRejectedValue(new Error("NEXT_REDIRECT /dashboard/signin"));
    await expect(setCandyValueAction(form({}))).rejects.toThrow(/signin/);
    await expect(revokeCreditAction(form({}))).rejects.toThrow(/signin/);
  });
});

describe("setting a value", () => {
  it("saves a typed number, taking the actor from the session and not the form", async () => {
    await expect(setCandyValueAction(set({ actorEmail: "forged@evil", email: "forged@evil" }))).rejects.toThrow(/Set to 12 candy/);
    expect(h.setBoardCandy).toHaveBeenCalledWith({ boardId: "duskfall-score", candy: 12, actorEmail: "owner@hallpass" });
  });

  it("takes a rubric preset when no number is typed, and a typed number wins over the preset", async () => {
    await expect(setCandyValueAction(set({ candy: "", preset: "25" }))).rejects.toThrow(/Set to 25/);
    expect(h.setBoardCandy).toHaveBeenLastCalledWith(expect.objectContaining({ candy: 25 }));
    await expect(setCandyValueAction(set({ candy: "3", preset: "25" }))).rejects.toThrow(/Set to 3/);
    expect(h.setBoardCandy).toHaveBeenLastCalledWith(expect.objectContaining({ candy: 3 }));
  });

  it("accepts the bounds 0 and 40 and refuses anything else before the database", async () => {
    await expect(setCandyValueAction(set({ candy: "0" }))).rejects.toThrow(/Set to 0/);
    await expect(setCandyValueAction(set({ candy: "40" }))).rejects.toThrow(/Set to 40/);
    h.setBoardCandy.mockClear();
    for (const bad of ["41", "-1", "2.5", "abc", "1e2", "999", "0x10"]) {
      await expect(setCandyValueAction(set({ candy: bad }))).rejects.toThrow(/whole number from 0 to 40/);
    }
    await expect(setCandyValueAction(set({ candy: "", preset: "" }))).rejects.toThrow(/Pick a rubric value/);
    expect(h.setBoardCandy).not.toHaveBeenCalled();
  });

  it("refuses a malformed board id", async () => {
    for (const bad of ["", "Duskfall", "has space", "-lead", "x;DROP TABLE boards", "a".repeat(121)]) {
      await expect(setCandyValueAction(set({ boardId: bad }))).rejects.toThrow(/board id/);
    }
    expect(h.setBoardCandy).not.toHaveBeenCalled();
  });

  it("reports unchanged, missing and database failures, and keeps the game filter on the way back", async () => {
    h.setBoardCandy.mockResolvedValueOnce("unchanged");
    await expect(setCandyValueAction(set())).rejects.toThrow(/NEXT_REDIRECT \/dashboard\/candy\?game=last-bell&ok=Already 12/);
    h.setBoardCandy.mockResolvedValueOnce("not-found");
    await expect(setCandyValueAction(set())).rejects.toThrow(/No such board/);
    h.setBoardCandy.mockRejectedValueOnce(new Error("neon down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(setCandyValueAction(set())).rejects.toThrow(/050_candy/);
    err.mockRestore();
  });

  it("logs through the store with the actor from the session, so every change is audited", async () => {
    await expect(setCandyValueAction(set({ candy: "5" }))).rejects.toThrow(/Set to 5/);
    expect(h.setBoardCandy).toHaveBeenCalledTimes(1);
    expect(h.setBoardCandy.mock.calls[0][0]).toEqual({ boardId: "duskfall-score", candy: 5, actorEmail: "owner@hallpass" });
  });

  it("drops a game filter that is not a slug", async () => {
    await expect(setCandyValueAction(set({ game: "../../x" }))).rejects.toThrow(/NEXT_REDIRECT \/dashboard\/candy\?ok=/);
  });
});

describe("revoking a credit", () => {
  it("needs a reason, and writes nothing without one", async () => {
    await expect(revokeCreditAction(revoke({ reason: "   " }))).rejects.toThrow(/Give a reason/);
    await expect(revokeCreditAction(revoke({ reason: "x".repeat(501) }))).rejects.toThrow(/too long/);
    expect(h.revokeCredit).not.toHaveBeenCalled();
  });

  it("refuses a malformed ledger id before the database", async () => {
    for (const bad of ["", "0", "-1", "1.5", "abc"]) {
      await expect(revokeCreditAction(revoke({ ledgerId: bad }))).rejects.toThrow(/credit id/);
    }
    expect(h.revokeCredit).not.toHaveBeenCalled();
  });

  it("revokes with the session's email, the typed reason and the id", async () => {
    await expect(revokeCreditAction(revoke({ actorEmail: "forged@evil" }))).rejects.toThrow(/Credit #9 revoked/);
    expect(h.revokeCredit).toHaveBeenCalledWith({ ledgerId: 9, actorEmail: "owner@hallpass", reason: "Farmed with a script" });
  });

  it("says so when nothing changed (a spend, already revoked, no such row) and on a database failure", async () => {
    h.revokeCredit.mockResolvedValueOnce(false);
    await expect(revokeCreditAction(revoke())).rejects.toThrow(/was not changed/);
    h.revokeCredit.mockRejectedValueOnce(new Error("neon down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(revokeCreditAction(revoke())).rejects.toThrow(/050_candy/);
    err.mockRestore();
  });
});
