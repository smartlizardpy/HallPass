/**
 * Tests for `publishGameAction`: the ORDER of operations and the invalidations.
 *
 * Every collaborator is a mock that appends to one shared `log`, so the assertions
 * read as the sequence the action actually performed. The load-bearing claims are
 * that the flip to public is the LAST write, that a failure before it leaves the
 * game staged, and that the caches are invalidated only on success.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  log: [] as string[],
  game: undefined as undefined | Record<string, unknown>,
  indexBlobs: [{ pathname: "games/g/index.html" }] as { pathname: string }[],
  shot: null as null | Record<string, unknown>,
  boards: [{ slug: "b1" }, { slug: "b2" }] as { slug: string }[],
  blobOpOn: true,
  failAt: null as null | string,
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
vi.mock("@/app/lib/beta", () => ({
  BETA_CREDITS_CACHE_TAG: "beta-game-credits",
  beta: {
    shotById: async () => h.shot,
    markShotPromoted: async (id: string, media: string) => step(`markPromoted:${id}:${media}`),
  },
}));
vi.mock("@/app/lib/beta/publish-shot", () => ({
  publishShotToGallery: async (shot: { id: string }) => {
    step("promote");
    return shot.id;
  },
}));
vi.mock("@/app/lib/game-blob-index", () => ({
  readGameBlobsForSlug: async () => h.indexBlobs,
}));
vi.mock("@/app/lib/game-media", () => ({
  MEDIA_CACHE_TAG: "game-media",
  mediaBlobPath: (slug: string, id: string) => `game-media/${slug}/${id}.png`,
  mediaPublicPath: (m: { blobPath: string }) => `/${m.blobPath}`,
  setMediaKind: async (id: string, kind: string) => {
    step(`kind:${id}:${kind}`);
    return true;
  },
}));
vi.mock("@/app/lib/image-meta", () => ({ toImageType: () => "image/png" }));
vi.mock("@/app/lib/games-store", () => ({
  CACHE_TAG: "game-overrides",
  resolveGameIncludingStaged: async () => h.game,
  setGameCover: async (slug: string, url: string) => step(`cover:${slug}:${url}`),
  setGameStaged: async (slug: string, v: boolean) => step(`staged:${slug}:${v}`),
}));
vi.mock("@/app/lib/external-games-store", () => ({
  EXTERNAL_CACHE_TAG: "external-games",
  setExternalGameStaged: async (slug: string, v: boolean) => step(`extStaged:${slug}:${v}`),
  updateExternalGameCover: async (slug: string, url: string) => step(`extCover:${slug}:${url}`),
}));
vi.mock("@/app/lib/scoreboard", () => ({
  store: {
    listBoardsForGame: async (slug: string) => {
      step(`listBoards:${slug}`);
      return h.boards;
    },
    clearBoardScores: async (id: string) => step(`clear:${id}`),
  },
}));

import { publishGameAction } from "./publish-actions";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function run(fields: Record<string, string>): Promise<string> {
  try {
    await publishGameAction(form(fields));
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected a redirect");
}

const writes = () => h.log.filter((l) => !l.startsWith("tag:") && !l.startsWith("path:"));
const tags = () => h.log.filter((l) => l.startsWith("tag:"));

beforeEach(() => {
  h.log = [];
  h.game = { slug: "g", title: "G", staged: true };
  h.indexBlobs = [{ pathname: "games/g/index.html" }];
  h.shot = {
    id: "s1",
    slug: "g",
    kind: "cover",
    status: "accepted",
    promotedMediaId: null,
    contentType: "image/png",
  };
  h.boards = [{ slug: "b1" }, { slug: "b2" }];
  h.blobOpOn = true;
  h.failAt = null;
});

describe("publishGameAction", () => {
  it("runs cover, reset, then the flip LAST, in the plan's order", async () => {
    const out = await run({ slug: "g", coverShotId: "s1", resetBoards: "on" });
    expect(out).toContain("ok=");
    expect(writes()).toEqual([
      "role:admin",
      "promote",
      "markPromoted:s1:s1",
      "kind:s1:hero",
      "cover:g:/game-media/g/s1.png",
      "listBoards:g",
      "clear:b1",
      "clear:b2",
      "staged:g:false",
      expect.stringContaining("redirect:"),
    ]);
  });

  it("skips the promotion copy when the shot already has a media row", async () => {
    h.shot = { ...h.shot!, promotedMediaId: "m9" };
    await run({ slug: "g", coverShotId: "s1" });
    expect(h.log).not.toContain("promote");
    expect(h.log).toContain("kind:m9:hero");
    expect(h.log).toContain("cover:g:/game-media/g/m9.png");
  });

  it("keeps the current cover and skips the reset when neither is asked for", async () => {
    await run({ slug: "g", coverShotId: "", resetBoards: "" });
    expect(writes().slice(0, -1)).toEqual(["role:admin", "staged:g:false"]);
  });

  it("invalidates every cache tag and the public surfaces on success, and does not bump the games version", async () => {
    await run({ slug: "g" });
    expect(tags()).toEqual([
      "tag:game-overrides",
      "tag:external-games",
      "tag:game-media",
      "tag:beta-game-credits",
    ]);
    for (const p of [
      "path:/",
      "path:/new",
      "path:/game/g",
      "path:/category/[category]#page",
      "path:/tag/[tag]#page",
      "path:/sitemap.xml",
      "path:/llms-full.txt",
    ]) {
      expect(h.log).toContain(p);
    }
    expect(h.log.join(" ")).not.toContain("games-version");
  });

  it("invalidates AFTER the flip, never before", async () => {
    await run({ slug: "g" });
    expect(h.log.indexOf("staged:g:false")).toBeLessThan(h.log.findIndex((l) => l.startsWith("tag:")));
  });

  it.each([["promote"], ["kind:s1:hero"], ["cover:g:/game-media/g/s1.png"], ["clear:b1"]])(
    "a failure at %s leaves the game staged and invalidates nothing",
    async (failAt) => {
      h.failAt = failAt;
      const out = await run({ slug: "g", coverShotId: "s1", resetBoards: "on" });
      expect(out).toContain("error=");
      expect(h.log).not.toContain("staged:g:false");
      expect(tags()).toEqual([]);
    },
  );

  it("a failed flip reports an error and invalidates nothing", async () => {
    h.failAt = "staged:g:false";
    expect(await run({ slug: "g" })).toContain("error=");
    expect(tags()).toEqual([]);
  });

  it("refuses an already-public game before writing anything", async () => {
    h.game = { slug: "g", title: "G", staged: false };
    expect(await run({ slug: "g", coverShotId: "s1" })).toContain("error=");
    expect(writes().filter((l) => !l.startsWith("redirect") && l !== "role:admin")).toEqual([]);
  });

  it("refuses an unknown game", async () => {
    h.game = undefined;
    expect(await run({ slug: "g" })).toContain("Unknown");
  });

  it("refuses a native game with no index blob", async () => {
    h.indexBlobs = [];
    expect(await run({ slug: "g" })).toContain("error=");
    expect(h.log).not.toContain("staged:g:false");
  });

  it("does not need an index blob for an external game, and flips the external flag", async () => {
    h.game = { slug: "g", title: "G", staged: true, externalUrl: "https://x.test" };
    h.indexBlobs = [];
    await run({ slug: "g", coverShotId: "s1" });
    expect(h.log).toContain("extCover:g:/game-media/g/s1.png");
    expect(h.log).toContain("extStaged:g:false");
    expect(h.log).not.toContain("staged:g:false");
  });

  it.each([
    ["another game's shot", { slug: "other" }],
    ["a screenshot", { kind: "screenshot" }],
    ["a pending shot", { status: "pending" }],
  ])("rejects %s as the cover", async (_name, patch) => {
    h.shot = { ...h.shot!, ...patch };
    expect(await run({ slug: "g", coverShotId: "s1" })).toContain("error=");
    expect(h.log).not.toContain("promote");
    expect(h.log).not.toContain("staged:g:false");
  });

  it("refuses to promote a fresh shot while shot promotion is switched off", async () => {
    h.blobOpOn = false;
    expect(await run({ slug: "g", coverShotId: "s1" })).toContain("error=");
    expect(h.log).not.toContain("promote");
  });
});
