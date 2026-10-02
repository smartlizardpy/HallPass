/**
 * Tests for `changeCoverAction`: validation happens before any write, the
 * pointer write is last, caches are invalidated only on success.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  log: [] as string[],
  game: undefined as undefined | Record<string, unknown>,
  shot: null as null | Record<string, unknown>,
  mediaOk: true,
  blobOpOn: true,
  failAt: null as null | string,
}));

function step(name: string) {
  h.log.push(name);
  if (h.failAt === name) throw new Error(`boom ${name}`);
}

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.log.push(`redirect:${url}`);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/app/lib/auth", () => ({
  requireRole: async (role: string) => {
    h.log.push(`role:${role}`);
    return { email: "a@x", role: "admin", playerId: "p" };
  },
}));
vi.mock("@/app/lib/blob-ops", () => ({
  isBlobOpEnabled: async () => h.blobOpOn,
  blobOpDisabledMessage: () => "promotion is off",
}));
vi.mock("@/app/lib/beta", () => ({ beta: { shotById: async () => h.shot } }));
vi.mock("@/app/lib/games-store", () => ({ resolveGameIncludingStaged: async () => h.game }));
vi.mock("@/app/lib/game-cover", () => ({
  setCoverFromShot: async (shot: { id: string }, ext: boolean) => step(`fromShot:${shot.id}:${ext}`),
  setCoverFromMedia: async (slug: string, id: string, ext: boolean) => {
    step(`fromMedia:${slug}:${id}:${ext}`);
    return h.mediaOk ? `/game-media/${slug}/${id}.png` : null;
  },
  clearCover: async (slug: string) => step(`clear:${slug}`),
  invalidateCover: (slug: string) => h.log.push(`invalidate:${slug}`),
}));

import { changeCoverAction } from "./cover-actions";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function run(fields: Record<string, string>): Promise<string> {
  try {
    await changeCoverAction(form(fields));
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  h.log = [];
  h.game = { slug: "g", title: "G", staged: false };
  h.shot = { id: "s1", slug: "g", kind: "cover", status: "accepted", promotedMediaId: null };
  h.mediaOk = true;
  h.blobOpOn = true;
  h.failAt = null;
});

describe("changeCoverAction", () => {
  it("sets a tester shot as the cover on a LIVE game, then invalidates", async () => {
    const out = await run({ slug: "g", source: "shot", id: "s1" });
    expect(out).toContain("ok=");
    expect(out).toContain("deploy");
    expect(h.log).toEqual(["role:admin", "fromShot:s1:false", "invalidate:g", expect.stringContaining("redirect:")]);
  });

  it("works on a staged game and passes the external flag through", async () => {
    h.game = { slug: "g", staged: true, externalUrl: "https://x.test" };
    await run({ slug: "g", source: "shot", id: "s1" });
    expect(h.log).toContain("fromShot:s1:true");
  });

  it.each([
    ["another game's shot", { slug: "other" }],
    ["a screenshot", { kind: "screenshot" }],
    ["a pending shot", { status: "pending" }],
  ])("rejects %s with nothing written", async (_n, patch) => {
    h.shot = { ...h.shot!, ...patch };
    expect(await run({ slug: "g", source: "shot", id: "s1" })).toContain("error=");
    expect(h.log.some((l) => l.startsWith("fromShot") || l.startsWith("invalidate"))).toBe(false);
  });

  it("refuses a fresh shot while promotion is switched off, but allows an already-promoted one", async () => {
    h.blobOpOn = false;
    expect(await run({ slug: "g", source: "shot", id: "s1" })).toContain("error=");
    expect(h.log).not.toContain("fromShot:s1:false");
    h.log = [];
    h.shot = { ...h.shot!, promotedMediaId: "m1" };
    expect(await run({ slug: "g", source: "shot", id: "s1" })).toContain("ok=");
  });

  it("a failed write reports an error and invalidates nothing", async () => {
    h.failAt = "fromShot:s1:false";
    expect(await run({ slug: "g", source: "shot", id: "s1" })).toContain("error=");
    expect(h.log.some((l) => l.startsWith("invalidate"))).toBe(false);
  });

  it("uses a previous cover or gallery screenshot by media id", async () => {
    expect(await run({ slug: "g", source: "media", id: "m1" })).toContain("ok=");
    expect(h.log).toContain("fromMedia:g:m1:false");
    expect(h.log).toContain("invalidate:g");
  });

  it("reports a media id that is not this game's, without invalidating", async () => {
    h.mediaOk = false;
    expect(await run({ slug: "g", source: "media", id: "zz" })).toContain("error=");
    expect(h.log.some((l) => l.startsWith("invalidate"))).toBe(false);
  });

  it("restores the original cover for a native game", async () => {
    expect(await run({ slug: "g", source: "original" })).toContain("ok=");
    expect(h.log).toContain("clear:g");
    expect(h.log).toContain("invalidate:g");
  });

  it("refuses 'original' for an external game", async () => {
    h.game = { slug: "g", externalUrl: "https://x.test" };
    expect(await run({ slug: "g", source: "original" })).toContain("error=");
    expect(h.log).not.toContain("clear:g");
  });

  it("refuses an unknown game, a missing id and an unknown source", async () => {
    h.game = undefined;
    expect(await run({ slug: "g", source: "shot", id: "s1" })).toContain("Unknown");
    h.game = { slug: "g" };
    expect(await run({ slug: "g", source: "shot", id: "" })).toContain("error=");
    expect(await run({ slug: "g", source: "nope" })).toContain("error=");
  });
});
