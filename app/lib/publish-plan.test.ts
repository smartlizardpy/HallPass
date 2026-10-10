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
  planRepublish,
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
    expect(classifyPublish(1, false)).toBe("single");
    expect(classifyPublish(1, true)).toBe("single");
  });
  it("allows a bundle while index.html is unpublished, refuses it after", () => {
    expect(classifyPublish(5, false)).toBe("bundle-first");
    expect(classifyPublish(5, true)).toBe("refuse-bundle");
  });
  it("lets a half-finished first upload be retried", () => {
    // Asset rows exist but index.html's does not, so the caller passes false.
    expect(classifyPublish(5, false)).toBe("bundle-first");
  });
  it("republishes a published bundle only when asked", () => {
    expect(classifyPublish(5, true, true)).toBe("bundle-republish");
    expect(classifyPublish(5, true, false)).toBe("refuse-bundle");
  });
  it("--republish changes nothing for a first upload or a lone file", () => {
    expect(classifyPublish(5, false, true)).toBe("bundle-first");
    expect(classifyPublish(1, true, true)).toBe("single");
  });
});

describe("--republish argument", () => {
  it("is off by default and parsed as a flag", () => {
    expect(parsePublishArgs(["g"]).republish).toBe(false);
    expect(
      parsePublishArgs(["g", "--staged", "--from", ".staging/g", "--republish", "--yes"]),
    ).toMatchObject({ slug: "g", staged: true, republish: true, yes: true, error: null });
  });
});

describe("planRepublish", () => {
  const h = (c: string) => c.repeat(64);
  const local = (...entries: [string, string][]) =>
    entries.map(([rel, c]) => ({ rel, sha256: h(c) }));
  const pub = (...entries: [string, string | null][]) =>
    entries.map(([name, c]) => ({
      pathname: `games/g/${name}`,
      sha256: c === null ? null : h(c),
    }));

  it("skips files whose bytes match, writes the changed and new ones", () => {
    const r = planRepublish({
      slug: "g",
      local: local(["index.html", "a"], ["game.js", "b"], ["new.js", "c"]),
      published: pub(["index.html", "a"], ["game.js", "x"]),
    });
    expect(r.skip).toEqual(["index.html"]);
    expect(r.write).toEqual(["game.js", "new.js"]);
    expect(r.stale).toEqual([]);
    expect(r.error).toBeNull();
  });

  it("never reads a missing fingerprint as 'same'", () => {
    const r = planRepublish({
      slug: "g",
      local: local(["index.html", "a"]),
      published: pub(["index.html", null]),
    });
    expect(r.write).toEqual(["index.html"]);
    expect(r.skip).toEqual([]);
  });

  it("names the published files the folder no longer contains", () => {
    const r = planRepublish({
      slug: "g",
      local: local(["index.html", "a"], ["a.js", "a"], ["b.js", "a"]),
      published: pub(["index.html", "a"], ["a.js", "a"], ["b.js", "a"], ["old.js", "a"]),
    });
    expect(r.stale).toEqual(["games/g/old.js"]);
    expect(r.error).toBeNull();
  });

  it("only ever considers this game's own prefix", () => {
    const r = planRepublish({
      slug: "g",
      local: local(["index.html", "a"]),
      published: [
        ...pub(["index.html", "a"]),
        { pathname: "games/other/index.html", sha256: h("a") },
        { pathname: "games/gg/index.html", sha256: h("a") },
      ],
    });
    expect(r.stale).toEqual([]);
  });

  it("refuses a folder with no index.html", () => {
    const r = planRepublish({
      slug: "g",
      local: local(["game.js", "a"]),
      published: pub(["index.html", "a"], ["game.js", "a"]),
    });
    expect(r.error).toMatch(/index\.html/);
  });

  it("refuses to delete more than half of what is published (wrong folder)", () => {
    const r = planRepublish({
      slug: "g",
      local: local(["index.html", "a"]),
      published: pub(["index.html", "a"], ["1.js", "a"], ["2.js", "a"], ["3.js", "a"]),
    });
    expect(r.stale).toHaveLength(3);
    expect(r.error).toMatch(/delete 3 of the 4/);
  });

  it("allows deleting exactly half", () => {
    const r = planRepublish({
      slug: "g",
      local: local(["index.html", "a"], ["1.js", "a"]),
      published: pub(["index.html", "a"], ["1.js", "a"], ["2.js", "a"], ["3.js", "a"]),
    });
    expect(r.stale).toHaveLength(2);
    expect(r.error).toBeNull();
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
