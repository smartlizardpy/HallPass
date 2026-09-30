/**
 * A staged game must not be featured or marked NEW: the first would put a game the
 * public cannot open on the homepage, the second announces it to everyone.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as string[], staged: true }));

vi.mock("next/cache", () => ({ updateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/app/lib/auth", () => ({ requireRole: async () => ({ email: "a@x" }) }));
vi.mock("@/app/lib/games", () => ({ games: [{ slug: "g" }] }));
vi.mock("@/app/lib/games-store", () => ({
  CACHE_TAG: "game-overrides",
  isStagedSlug: async () => h.staged,
  setFeaturedGame: async () => void h.calls.push("feature"),
  setGameNew: async () => void h.calls.push("new"),
}));
vi.mock("@/app/lib/notifications/copy", () => ({ gameDropCopy: () => ({}) }));
vi.mock("@/app/lib/notifications/deliver", () => ({
  notifyEveryone: async () => void h.calls.push("notify"),
}));

import { setFeaturedAction, toggleNewAction } from "./actions";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  h.calls = [];
  h.staged = true;
});

describe("curation and staged games", () => {
  it("refuses to feature a staged game", async () => {
    await expect(setFeaturedAction(form({ slug: "g" }))).rejects.toThrow(/staged/);
    expect(h.calls).toEqual([]);
  });

  it("refuses to mark a staged game new, and announces nothing", async () => {
    await expect(toggleNewAction(form({ slug: "g", value: "true" }))).rejects.toThrow(/staged/);
    expect(h.calls).toEqual([]);
  });

  it("still features a public game", async () => {
    h.staged = false;
    await expect(setFeaturedAction(form({ slug: "g" }))).rejects.toThrow(/ok=/);
    expect(h.calls).toEqual(["feature"]);
  });
});
