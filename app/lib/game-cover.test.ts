/**
 * Tests for the shared cover-change helpers: the write ORDER (pointer last) and
 * which store each game kind writes to.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  log: [] as string[],
  media: null as null | { id: string; blobPath: string },
  failAt: null as null | string,
  kindOk: [] as boolean[],
  blobOpOn: true,
}));

function step(name: string) {
  h.log.push(name);
  if (h.failAt === name) throw new Error(`boom ${name}`);
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  updateTag: (t: string) => h.log.push(`tag:${t}`),
  revalidatePath: (p: string, type?: string) => h.log.push(`path:${p}${type ? `#${type}` : ""}`),
}));
vi.mock("@/app/lib/beta", () => ({
  BETA_CREDITS_CACHE_TAG: "beta-game-credits",
  beta: { markShotPromoted: async (id: string, m: string) => step(`markPromoted:${id}:${m}`) },
}));
vi.mock("@/app/lib/blob-ops", () => ({
  isBlobOpEnabled: async () => h.blobOpOn,
  blobOpDisabledMessage: () => "promotion is off",
}));
vi.mock("@/app/lib/beta/publish-shot", () => ({
  publishShotToGallery: async (shot: { id: string }) => {
    step("promote");
    return shot.id;
  },
}));
vi.mock("@/app/lib/game-media", () => ({
  MEDIA_CACHE_TAG: "game-media",
  mediaBlobPath: (slug: string, id: string) => `game-media/${slug}/${id}.png`,
  mediaPublicPath: (m: { blobPath: string }) => `/${m.blobPath}`,
  getMediaForSlug: async () => h.media,
  setMediaKind: async (id: string, kind: string) => {
    step(`kind:${id}:${kind}`);
    return h.kindOk.length > 0 ? h.kindOk.shift()! : true;
  },
}));
vi.mock("@/app/lib/image-meta", () => ({ toImageType: () => "image/png" }));
vi.mock("@/app/lib/games-store", () => ({
  CACHE_TAG: "game-overrides",
  setGameCover: async (slug: string, url: string | null) => step(`cover:${slug}:${url}`),
}));
vi.mock("@/app/lib/external-games-store", () => ({
  EXTERNAL_CACHE_TAG: "external-games",
  updateExternalGameCover: async (slug: string, url: string | null) => step(`extCover:${slug}:${url}`),
}));

import { clearCover, invalidateCover, setCoverFromMedia, setCoverFromShot } from "@/app/lib/game-cover";

const shot = (over: Record<string, unknown> = {}) =>
  ({ id: "s1", slug: "g", contentType: "image/png", promotedMediaId: null, ...over }) as never;

beforeEach(() => {
  h.log = [];
  h.media = { id: "m1", blobPath: "game-media/g/m1.png" };
  h.failAt = null;
  h.kindOk = [];
  h.blobOpOn = true;
});

describe("setCoverFromShot", () => {
  it("promotes, marks, flips to hero, and writes the pointer LAST", async () => {
    expect(await setCoverFromShot(shot(), false)).toBe("/game-media/g/s1.png");
    expect(h.log).toEqual(["promote", "markPromoted:s1:s1", "kind:s1:hero", "cover:g:/game-media/g/s1.png"]);
  });

  it("skips the copy for an already-promoted shot and uses its media id", async () => {
    await setCoverFromShot(shot({ promotedMediaId: "m9" }), false);
    expect(h.log).toEqual(["kind:m9:hero", "cover:g:/game-media/g/m9.png"]);
  });

  it("writes the external store for an external game", async () => {
    await setCoverFromShot(shot(), true);
    expect(h.log.at(-1)).toBe("extCover:g:/game-media/g/s1.png");
  });

  it("re-promotes a promoted shot whose media row was deleted, instead of pointing at nothing", async () => {
    h.kindOk = [false, true];
    await setCoverFromShot(shot({ promotedMediaId: "s1" }), false);
    expect(h.log).toEqual(["kind:s1:hero", "promote", "kind:s1:hero", "cover:g:/game-media/g/s1.png"]);
  });

  it("keeps the old cover when the row is gone and promotion is switched off", async () => {
    h.kindOk = [false];
    h.blobOpOn = false;
    await expect(setCoverFromShot(shot({ promotedMediaId: "s1" }), false)).rejects.toThrow();
    expect(h.log.some((l) => l.startsWith("cover:"))).toBe(false);
  });

  it("keeps the old cover when the row is still missing after re-promotion", async () => {
    h.kindOk = [false, false];
    await expect(setCoverFromShot(shot({ promotedMediaId: "s1" }), false)).rejects.toThrow();
    expect(h.log.some((l) => l.startsWith("cover:"))).toBe(false);
  });

  it("a failure before the pointer leaves the pointer unwritten", async () => {
    h.failAt = "kind:s1:hero";
    await expect(setCoverFromShot(shot(), false)).rejects.toThrow();
    expect(h.log.some((l) => l.startsWith("cover:"))).toBe(false);
  });
});

describe("setCoverFromMedia", () => {
  it("moves the row to hero then points the cover at it", async () => {
    expect(await setCoverFromMedia("g", "m1", false)).toBe("/game-media/g/m1.png");
    expect(h.log).toEqual(["kind:m1:hero", "cover:g:/game-media/g/m1.png"]);
  });

  it("returns null and writes nothing for an id that is not this game's", async () => {
    h.media = null;
    expect(await setCoverFromMedia("g", "zz", false)).toBeNull();
    expect(h.log).toEqual([]);
  });
});

describe("clearCover / invalidateCover", () => {
  it("clearCover nulls the override", async () => {
    await clearCover("g");
    expect(h.log).toEqual(["cover:g:null"]);
  });

  it("invalidates the catalogue, media and the surfaces the cover appears on", () => {
    invalidateCover("g");
    for (const l of ["tag:game-overrides", "tag:external-games", "tag:game-media", "path:/", "path:/game/g", "path:/category/[category]#page"]) {
      expect(h.log).toContain(l);
    }
    expect(h.log.join(" ")).not.toContain("games-version");
  });
});
