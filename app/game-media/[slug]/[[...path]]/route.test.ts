/**
 * Route-level tests for the staged gate on `/game-media`: auth only for staged
 * games, denied === unknown (plus no-store), and a staged 200 is never
 * `immutable`/public.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveGameIncludingStaged: vi.fn(),
  canViewStaged: vi.fn(),
  getMediaByBlobPath: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ head: vi.fn() }));
vi.mock("@/app/lib/games-store", () => ({
  resolveGameIncludingStaged: mocks.resolveGameIncludingStaged,
}));
vi.mock("@/app/lib/beta/staged-access", () => ({
  canViewStaged: mocks.canViewStaged,
}));
vi.mock("@/app/lib/game-media", () => ({
  getMediaByBlobPath: mocks.getMediaByBlobPath,
  mediaBlobPrefix: (slug: string) => `game-media/${slug}/`,
  setMediaBlobUrl: vi.fn(),
}));

import { GET } from "./route";

const call = (slug: string, file = "abc.png") =>
  GET(new Request("https://hp.test/x"), {
    params: Promise.resolve({ slug, path: [file] }),
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveGameIncludingStaged.mockImplementation(async (s: string) =>
    s === "pub" ? { slug: "pub" } : s === "beta" ? { slug: "beta", staged: true } : undefined,
  );
  mocks.getMediaByBlobPath.mockResolvedValue({
    blobUrl: "https://blob.test/m.png",
    contentType: "image/png",
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("png", { status: 200 })));
});

describe("/game-media staged gate", () => {
  it("does not call canViewStaged for a public game and keeps immutable caching", async () => {
    const res = await call("pub");
    expect(mocks.canViewStaged).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
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
    expect(mocks.getMediaByBlobPath).not.toHaveBeenCalled();
  });

  it("serves staged media to a tester as private, no-store", async () => {
    mocks.canViewStaged.mockResolvedValue(true);
    const res = await call("beta");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
