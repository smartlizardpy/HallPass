/**
 * Route-level tests for the staged gate on `/game-html`. The collaborators are
 * mocked; what is pinned is the SECURITY contract: auth is consulted only for a
 * staged slug, a denied request is byte-identical to an unknown slug, and a
 * staged 200 is never publicly cacheable or redirected to the static twin.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isStagedSlug: vi.fn(),
  canViewStaged: vi.fn(),
  getServingBlobMap: vi.fn(),
}));

vi.mock("@/app/lib/games-store", () => ({ isStagedSlug: mocks.isStagedSlug }));
vi.mock("@/app/lib/beta/staged-access", () => ({
  canViewStaged: mocks.canViewStaged,
}));
vi.mock("@/app/lib/game-serving-blobs", () => ({
  getServingBlobMap: mocks.getServingBlobMap,
}));
vi.mock("@/app/lib/games", () => ({
  games: [{ slug: "pub" }, { slug: "beta" }],
}));
vi.mock("@/app/lib/static-games-manifest", () => ({
  STATIC_GAME_FILES: new Set(["pub/index.html", "beta/index.html"]),
}));
vi.mock("@/app/lib/mirror-synced-at", () => ({ MIRROR_SYNCED_AT: 1000 }));

import { GET } from "./route";

const call = (slug: string, path?: string[]) =>
  GET(new Request(`https://hp.test/game-html/${slug}/`), {
    params: Promise.resolve({ slug, path }),
  });

const blobMap = (slug: string, uploadedAt: number) =>
  new Map([
    [
      `games/${slug}/index.html`,
      { url: `https://blob.test/games/${slug}/index.html`, uploadedAt },
    ],
  ]);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.isStagedSlug.mockImplementation(async (s: string) => s === "beta");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<html>game</html>", { status: 200 })),
  );
});

describe("/game-html staged gate", () => {
  it("never calls canViewStaged for a public slug, and keeps its 307", async () => {
    mocks.getServingBlobMap.mockResolvedValue(blobMap("pub", 1));
    const res = await call("pub");
    expect(mocks.canViewStaged).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://hp.test/games/pub/index.html");
  });

  it("keeps the public cache header on a public proxied 200", async () => {
    mocks.getServingBlobMap.mockResolvedValue(blobMap("pub", 5000));
    const res = await call("pub");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
  });

  it("denies a staged slug exactly like an unknown slug, with no-store", async () => {
    mocks.canViewStaged.mockResolvedValue(false);
    const denied = await call("beta");
    const unknown = await call("nope");
    expect(denied.status).toBe(404);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("cache-control")).toBe("no-store");
    expect(await denied.text()).toBe(await unknown.text());
    expect(mocks.getServingBlobMap).not.toHaveBeenCalled();
  });

  it("serves a staged game to a tester as private, no-store, from Blob", async () => {
    mocks.canViewStaged.mockResolvedValue(true);
    // Older than the mirror AND a static twin exists: a public game would 307.
    mocks.getServingBlobMap.mockResolvedValue(blobMap("beta", 1));
    const res = await call("beta");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toBe("<html>game</html>");
  });

  it("404s a permitted staged game whose blob is missing, never a 307", async () => {
    mocks.canViewStaged.mockResolvedValue(true);
    mocks.getServingBlobMap.mockResolvedValue(new Map());
    const res = await call("beta");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("404s a staged game whose upstream fetch fails, never a 307", async () => {
    mocks.canViewStaged.mockResolvedValue(true);
    mocks.getServingBlobMap.mockResolvedValue(blobMap("beta", 1));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    const res = await call("beta");
    expect(res.status).toBe(404);
  });
});
