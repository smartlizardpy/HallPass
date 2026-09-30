/**
 * Tests for `scripts/lib/publish-plan.mjs`, the pure half of `publish-game`.
 * Nothing here touches Blob or the database; that is the point of the split.
 * (Under `app/` because vitest's `include` only covers `app/**` and `sdk/**`.)
 */

import { describe, expect, it } from "vitest";
import {
  classifyPublish,
  contentTypeForPath,
  heroIdentity,
  isInsidePublic,
  parsePublishArgs,
  planUploads,
  readPngSize,
} from "../../scripts/lib/publish-plan.mjs";

describe("parsePublishArgs", () => {
  it("parses a plain publish", () => {
    expect(parsePublishArgs(["neon-x", "--yes"])).toMatchObject({
      slug: "neon-x",
      yes: true,
      staged: false,
      error: null,
    });
  });

  it("parses a staged publish and does not mistake the folder for the slug", () => {
    expect(
      parsePublishArgs([
        "--staged",
        "--from",
        ".staging/neon-x",
        "--cover",
        "c.png",
        "neon-x",
      ]),
    ).toMatchObject({
      slug: "neon-x",
      staged: true,
      from: ".staging/neon-x",
      cover: "c.png",
      error: null,
    });
  });

  it.each([
    [[], "slug"],
    [["Bad_Slug"], "slug"],
    [["a", "b"], "one slug"],
    [["a", "--nope"], "unknown option"],
    [["a", "--staged"], "--from"],
    [["a", "--staged", "--from"], "needs a path"],
    [["a", "--from", "x"], "only for --staged"],
    [["a", "--cover", "x.png"], "only for --staged"],
  ])("rejects %j", (argv, message) => {
    expect(parsePublishArgs(argv as string[]).error).toContain(message);
  });
});

describe("isInsidePublic", () => {
  const pub = "/repo/public";
  it("flags public/ and anything under it", () => {
    expect(isInsidePublic("/repo/public", pub)).toBe(true);
    expect(isInsidePublic("/repo/public/games/x", pub)).toBe(true);
  });
  it("allows siblings, including ones sharing the prefix", () => {
    expect(isInsidePublic("/repo/.staging/x", pub)).toBe(false);
    expect(isInsidePublic("/repo/public-staging/x", pub)).toBe(false);
  });
});

describe("planUploads", () => {
  it("uploads game files and leaves cover.png in the repo", () => {
    const { uploads, errors } = planUploads([
      "index.html",
      "cover.png",
      "js/game.js",
      "audio/boom.mp3",
    ]);
    expect(errors).toEqual([]);
    expect(uploads.map((u) => u.rel)).toEqual([
      "audio/boom.mp3",
      "index.html",
      "js/game.js",
    ]);
    expect(uploads.find((u) => u.rel === "index.html")?.contentType).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("requires index.html", () => {
    expect(planUploads(["game.js"]).errors.join()).toContain("index.html");
  });

  it("rejects unsafe segments and over-deep paths", () => {
    const deep = Array.from({ length: 11 }, () => "d").join("/") + "/f.js";
    const { errors } = planUploads(["index.html", ".hidden", "a/../b.js", deep]);
    expect(errors).toHaveLength(3);
  });

  it("caps the file count", () => {
    const many = Array.from({ length: 301 }, (_, i) => `f${i}.js`);
    expect(planUploads(["index.html", ...many]).errors.join()).toContain("cap");
  });
});

describe("contentTypeForPath", () => {
  it("maps known extensions and defaults to octet-stream", () => {
    expect(contentTypeForPath("a/b.WOFF2")).toBe("font/woff2");
    expect(contentTypeForPath("a/b.bin")).toBe("application/octet-stream");
    expect(contentTypeForPath("noext")).toBe("application/octet-stream");
  });
});

describe("classifyPublish", () => {
  it("treats a lone file as single regardless of history", () => {
    expect(classifyPublish(1, 0)).toBe("single");
    expect(classifyPublish(1, 4)).toBe("single");
  });
  it("allows a bundle only as a first upload", () => {
    expect(classifyPublish(5, 0)).toBe("bundle-first");
    expect(classifyPublish(5, 1)).toBe("refuse-bundle");
  });
});

/** A minimal PNG header: signature + IHDR chunk with the given size. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(b.buffer).setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

describe("readPngSize", () => {
  it("reads IHDR dimensions", () => {
    expect(readPngSize(png(659, 613))).toEqual({ width: 659, height: 613 });
  });
  it("rejects non-PNGs, truncation and zero sizes", () => {
    expect(readPngSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readPngSize(new TextEncoder().encode("<svg></svg>".repeat(5)))).toBeNull();
    expect(readPngSize(png(0, 10))).toBeNull();
  });
});

describe("heroIdentity", () => {
  it("is content-addressed and lives under game-media/, never games/", () => {
    const a = heroIdentity("neon-x", png(659, 613));
    expect(a.id).toMatch(/^hero-[0-9a-f]{10}$/);
    expect(a.blobPath).toBe(`game-media/neon-x/${a.id}.png`);
    expect(a.publicPath).toBe(`/${a.blobPath}`);
    expect(heroIdentity("neon-x", png(659, 613))).toEqual(a);
    expect(heroIdentity("neon-x", png(660, 613)).id).not.toBe(a.id);
  });
});
