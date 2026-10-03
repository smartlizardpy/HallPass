/**
 * A player's handle can be the name printed in a game page's public tester
 * credit, and that page is prerendered from a cached read. So both account
 * actions must expire that credit, and deletion must find WHICH games credit the
 * player BEFORE deleting them — the assignments cascade away with the row, and a
 * lookup afterwards would answer "none" and leave the erased name on the page.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  log: [] as string[],
  failWrite: false,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.log.push(`redirect:${url}`);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/app/lib/auth", () => ({
  auth: async () => ({ user: { playerId: "p1" } }),
  signOut: async () => {
    h.log.push("signOut");
    throw new Error("NEXT_REDIRECT /");
  },
}));
vi.mock("@/app/lib/players", () => ({
  setPlayerHandle: async () => {
    h.log.push("setHandle");
    if (h.failWrite) throw new Error("neon down");
  },
  deletePlayer: async () => {
    h.log.push("delete");
    if (h.failWrite) throw new Error("neon down");
  },
}));
vi.mock("@/app/lib/beta", () => ({
  creditedSlugsFor: async () => {
    h.log.push("lookup");
    return ["neon-run"];
  },
  expireTesterCredits: (slugs: string[], from: string) =>
    void h.log.push(`expire:${slugs.join(",")}:${from}`),
}));

import { deleteAccountAction, setHandleAction } from "./actions";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  h.log = [];
  h.failWrite = false;
});

describe("account actions and the public tester credit", () => {
  it("deletion looks up the credited games first, then deletes, then expires them", async () => {
    await expect(deleteAccountAction(form({ confirm: "DELETE" }))).rejects.toThrow();
    expect(h.log).toEqual(["lookup", "delete", "expire:neon-run:action", "signOut"]);
  });

  it("a failed deletion expires nothing", async () => {
    h.failWrite = true;
    await expect(deleteAccountAction(form({ confirm: "DELETE" }))).rejects.toThrow(/error=db/);
    expect(h.log.some((l) => l.startsWith("expire"))).toBe(false);
  });

  it("a rename expires the credits that print the handle", async () => {
    await expect(setHandleAction(form({ handle: "ZK" }))).rejects.toThrow(/ok=1/);
    expect(h.log).toEqual([
      "setHandle",
      "lookup",
      "expire:neon-run:action",
      "redirect:/play/you/settings?ok=1",
    ]);
  });

  it("a failed rename expires nothing", async () => {
    h.failWrite = true;
    await expect(setHandleAction(form({ handle: "ZK" }))).rejects.toThrow(/error=db/);
    expect(h.log.some((l) => l.startsWith("expire"))).toBe(false);
  });
});
