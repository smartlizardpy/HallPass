import { describe, expect, it } from "vitest";
import { checkCompatibility } from "./compatibility";
import { sha256Hex } from "./hash";
import { parseManifest, validateManifest } from "./manifest";
import { isSafePackagePath, mimeTypeOf } from "./paths";
import { compareSemver, isSemver } from "./semver";

const HASH = "a".repeat(64);

function manifest(over: Record<string, unknown> = {}) {
  return {
    format: "hpg",
    formatVersion: 1,
    id: "example-game",
    name: "Example Game",
    version: "1.0.0",
    description: "An offline game",
    entry: "game.html",
    runtime: "html",
    offline: true,
    permissions: [],
    minimumLauncherVersion: "1.0.0",
    files: { "game.html": { size: 10, sha256: HASH, role: "entry" } },
    ...over,
  };
}

function errorsOf(input: unknown): string[] {
  const r = validateManifest(input);
  return r.ok ? [] : r.errors;
}

describe("isSafePackagePath", () => {
  it.each(["game.html", "assets/a.png", "wasm/mod-1.wasm", "a/b/c/d.js", "Cover_2.webp"])(
    "accepts %s",
    (p) => expect(isSafePackagePath(p)).toBe(true),
  );
  it.each([
    "",
    "../game.html",
    "a/../b",
    "./a",
    "/abs.html",
    "a//b",
    "a/",
    "C:/x",
    "a\\b",
    ".hidden",
    "a/.git/config",
    "nul\u0000.js",
    "spaced name.js",
    "ünïcode.js",
    "a/".repeat(9) + "x",
    "x".repeat(201),
  ])("rejects %j", (p) => expect(isSafePackagePath(p)).toBe(false));
  it("rejects non-strings", () => {
    expect(isSafePackagePath(null)).toBe(false);
    expect(isSafePackagePath(42)).toBe(false);
  });
});

describe("mimeTypeOf", () => {
  it("maps known extensions and falls back to octet-stream", () => {
    expect(mimeTypeOf("wasm/x.wasm")).toBe("application/wasm");
    expect(mimeTypeOf("a/B.PNG")).toBe("image/png");
    expect(mimeTypeOf("blob")).toBe("application/octet-stream");
  });
});

describe("semver", () => {
  it("validates", () => {
    expect(isSemver("1.0.0")).toBe(true);
    expect(isSemver("1.0.0-rc.1+abc")).toBe(true);
    expect(isSemver("1.0")).toBe(false);
    expect(isSemver("01.0.0")).toBe(false);
    expect(isSemver(1)).toBe(false);
  });
  it("orders releases, pre-releases and ignores build metadata", () => {
    expect(compareSemver("1.2.3", "1.10.0")).toBeLessThan(0);
    expect(compareSemver("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
    expect(compareSemver("1.0.0+a", "1.0.0+b")).toBe(0);
  });
});

describe("validateManifest", () => {
  it("accepts the minimal manifest from the spec", () => {
    expect(errorsOf(manifest())).toEqual([]);
  });

  it("accepts every optional field", () => {
    const m = manifest({
      thumbnail: "cover.webp",
      files: {
        "game.html": { size: 10, sha256: HASH, role: "entry" },
        "cover.webp": { size: 5, sha256: HASH, role: "thumbnail" },
        "assets/worker-1.js": { size: 5, sha256: HASH, role: "worker" },
      },
      category: "Strategy",
      tags: ["Strategy", "Naval"],
      author: "Somebody",
      accent: "#14e0ff",
      gradient: ["#07111c", "#14e0ff"],
      inputs: ["mouse", "touch"],
      display: { width: 1280, height: 720, orientation: "landscape" },
      compatibility: { webgl: false, workers: true, audio: true, notes: ["Fonts fall back"] },
      features: { scores: true, saves: true, scoreOrder: "asc" },
      build: { packager: "hpg-packager/1.0.0", source: "public/games/x", contentHash: HASH },
      permissions: ["pointer-lock"],
    });
    expect(errorsOf(m)).toEqual([]);
  });

  it("reports every problem at once with its field path", () => {
    const errs = errorsOf(
      manifest({ id: "Bad ID", version: "one", offline: false, runtime: "flash" }),
    );
    expect(errs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^id:/),
        expect.stringMatching(/^version:/),
        expect.stringMatching(/^offline:/),
        expect.stringMatching(/^runtime:/),
      ]),
    );
  });

  it("rejects unknown fields, top-level and nested", () => {
    expect(errorsOf(manifest({ extra: 1 }))).toContain("extra: unknown field");
    expect(errorsOf(manifest({ display: { depth: 3 } }))).toContain(
      "display.depth: unknown field",
    );
  });

  it("rejects unsupported entry types", () => {
    const errs = errorsOf(
      manifest({
        entry: "game.swf",
        files: { "game.swf": { size: 1, sha256: HASH, role: "entry" } },
      }),
    );
    expect(errs.some((e) => e.includes("unsupported entry type"))).toBe(true);
  });

  it("requires the entry to be listed with the entry role", () => {
    expect(errorsOf(manifest({ entry: "other.html" }))).toContain(
      'entry: must be listed in files with role "entry"',
    );
  });

  it("rejects traversal, self-listing, case collisions and bad hashes in files", () => {
    const errs = errorsOf(
      manifest({
        files: {
          "game.html": { size: 1, sha256: HASH, role: "entry" },
          "../evil.js": { size: 1, sha256: HASH, role: "asset" },
          "manifest.json": { size: 1, sha256: HASH, role: "asset" },
          "A.png": { size: 1, sha256: HASH, role: "asset" },
          "a.png": { size: 1, sha256: "XYZ", role: "asset" },
        },
      }),
    );
    expect(errs.join("\n")).toMatch(/"\.\.\/evil\.js"\]: unsafe/);
    expect(errs.join("\n")).toMatch(/cannot list itself/);
    expect(errs.join("\n")).toMatch(/collides with "A\.png"/);
    expect(errs.join("\n")).toMatch(/a\.png"\]\.sha256/);
  });

  it("ties runtime to the presence of WebAssembly", () => {
    const wasmFiles = {
      "game.html": { size: 1, sha256: HASH, role: "entry" },
      "wasm/m.wasm": { size: 1, sha256: HASH, role: "wasm" },
    };
    expect(errorsOf(manifest({ runtime: "wasm", files: wasmFiles }))).toEqual([]);
    expect(errorsOf(manifest({ runtime: "html", files: wasmFiles })).join()).toMatch(
      /must declare runtime "wasm"/,
    );
    expect(errorsOf(manifest({ runtime: "wasm" })).join()).toMatch(/requires at least one/);
  });

  it("rejects a thumbnail that is not a listed raster image", () => {
    expect(errorsOf(manifest({ thumbnail: "cover.svg" })).join()).toMatch(/raster image/);
    expect(errorsOf(manifest({ thumbnail: "cover.png" })).join()).toMatch(/role "thumbnail"/);
  });

  it("rejects a newer format with a specific message", () => {
    expect(errorsOf(manifest({ formatVersion: 2 })).join()).toMatch(/newer than this launcher/);
  });

  it("rejects text with control characters or padding", () => {
    expect(errorsOf(manifest({ name: "Bad\nName" })).join()).toMatch(/^name:/);
    expect(errorsOf(manifest({ name: " padded" })).join()).toMatch(/^name:/);
  });

  it("parses bytes and rejects invalid UTF-8 or JSON", () => {
    const ok = parseManifest(new TextEncoder().encode(JSON.stringify(manifest())));
    expect(ok.ok).toBe(true);
    expect(parseManifest(new Uint8Array([0xff, 0xfe])).ok).toBe(false);
    expect(parseManifest(new TextEncoder().encode("{nope")).ok).toBe(false);
  });
});

describe("checkCompatibility", () => {
  it("refuses packages that need a newer launcher", () => {
    expect(checkCompatibility({ formatVersion: 1, minimumLauncherVersion: "1.0.0" }, "1.0.0")).toEqual({ ok: true });
    const r = checkCompatibility({ formatVersion: 1, minimumLauncherVersion: "1.2.0" }, "1.0.0");
    expect(r).toMatchObject({ ok: false, reason: "launcher-too-old" });
  });
});

describe("sha256Hex", () => {
  it("matches the FIPS 180-2 test vector", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
