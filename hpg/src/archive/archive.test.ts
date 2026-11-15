import { deflateSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { PACKAGE_LIMITS } from "../format/constants";
import { sha256Hex } from "../format/hash";
import { assemblePackage, type ManifestBase, type PackageFile } from "./assemble";
import { importSources } from "./collection";
import { PackageError, readPackage } from "./package";
import { crc32, listZip, readZipEntries, writeZip, ZipError } from "./zip";

const enc = (s: string) => new TextEncoder().encode(s);

function base(over: Partial<ManifestBase> = {}): ManifestBase {
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
    ...over,
  };
}

const GAME: PackageFile[] = [
  { path: "game.html", data: enc("<!doctype html><title>x</title><canvas></canvas>"), role: "entry" },
  { path: "assets/w.js", data: enc("onmessage=function(){}"), role: "worker" },
];

async function pkg(over: Partial<ManifestBase> = {}, files = GAME) {
  return assemblePackage(base(over), files);
}

/** Rewrite one entry's bytes inside a zip without fixing its manifest. */
function rezip(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, [v, { level: 6 }]])));
}

function unzipAll(bytes: Uint8Array): Record<string, Uint8Array> {
  const entries = listZip(bytes, PACKAGE_LIMITS);
  return Object.fromEntries(readZipEntries(bytes, entries, PACKAGE_LIMITS));
}

/** Find a central-directory record by name and patch a u32 field in it. */
function patchCentral(bytes: Uint8Array, name: string, fieldOffset: number, value: number): Uint8Array {
  const b = bytes.slice();
  const dv = new DataView(b.buffer);
  const n = enc(name);
  for (let i = 0; i < b.length - 46; i++) {
    if (dv.getUint32(i, true) !== 0x02014b50) continue;
    const len = dv.getUint16(i + 28, true);
    if (len === n.length && b.subarray(i + 46, i + 46 + len).every((c, j) => c === n[j])) {
      if (fieldOffset === 8) dv.setUint16(i + 8, value, true);
      else dv.setUint32(i + fieldOffset, value, true);
      return b;
    }
  }
  throw new Error(`no central entry ${name}`);
}

describe("zip", () => {
  it("round-trips deterministically", () => {
    const files = [
      { path: "a.txt", data: enc("hello") },
      { path: "img/b.png", data: new Uint8Array([1, 2, 3]), level: 0 as const },
    ];
    const one = writeZip(files);
    expect(writeZip(files)).toEqual(one);
    const back = unzipAll(one);
    expect(new TextDecoder().decode(back["a.txt"])).toBe("hello");
    expect(back["img/b.png"]).toEqual(new Uint8Array([1, 2, 3]));
    expect(listZip(one, PACKAGE_LIMITS).find((e) => e.name === "img/b.png")?.method).toBe(0);
  });

  it("computes the standard CRC-32", () => {
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
  });

  it("rejects non-zips and truncated archives", () => {
    expect(() => listZip(enc("not a zip at all, definitely not"), PACKAGE_LIMITS)).toThrow(ZipError);
    const z = writeZip([{ path: "a.txt", data: enc("hello") }]);
    expect(() => listZip(z.subarray(0, z.length - 30), PACKAGE_LIMITS)).toThrow(ZipError);
  });

  it("detects corrupted data by CRC", () => {
    const z = writeZip([{ path: "a.txt", data: enc("hello world"), level: 0 }]);
    const bad = z.slice();
    const idx = new TextDecoder("latin1").decode(bad).indexOf("hello world");
    bad[idx] ^= 0xff;
    expect(() => unzipAll(bad)).toThrow(/CRC-32/);
  });

  it("refuses an entry that inflates past its declared size (lying header)", () => {
    const big = enc("x".repeat(10_000));
    const z = writeZip([{ path: "a.txt", data: big }]);
    const lying = patchCentral(z, "a.txt", 24, 100); // declare 100 bytes
    expect(() => unzipAll(lying)).toThrow(expect.objectContaining({ code: "size-mismatch" }));
  });

  it("refuses decompression bombs by ratio before inflating", () => {
    const z = writeZip([{ path: "bomb.txt", data: new Uint8Array(5_000_000) }]);
    expect(() => unzipAll(z)).toThrow(expect.objectContaining({ code: "suspicious-ratio" }));
  });

  it("refuses declared sizes over the limits before inflating", () => {
    const z = writeZip([{ path: "a.txt", data: enc("small") }]);
    const huge = patchCentral(z, "a.txt", 24, PACKAGE_LIMITS.maxEntryBytes + 1);
    expect(() => unzipAll(huge)).toThrow(expect.objectContaining({ code: "entry-too-large" }));
    const limits = { ...PACKAGE_LIMITS, maxTotalBytes: 8 };
    const two = writeZip([{ path: "a.txt", data: enc("12345") }, { path: "b.txt", data: enc("12345") }]);
    expect(() => readZipEntries(two, listZip(two, limits), limits)).toThrow(expect.objectContaining({ code: "too-large" }));
  });

  it("refuses too many entries", () => {
    const files = Array.from({ length: 6 }, (_, i) => ({ path: `f${i}.txt`, data: enc("x") }));
    const limits = { ...PACKAGE_LIMITS, maxEntries: 5 };
    expect(() => listZip(writeZip(files), limits)).toThrow(expect.objectContaining({ code: "too-many-entries" }));
  });

  it("refuses encrypted entries and unknown methods", () => {
    const z = writeZip([{ path: "a.txt", data: enc("hello") }]);
    expect(() => listZip(patchCentral(z, "a.txt", 8, 0x0001), PACKAGE_LIMITS)).toThrow(/encrypted/);
  });

  it("flags traversal and absolute names as unsafe and refuses to read them", () => {
    const z = zipSync({ "../evil.js": enc("x"), "/abs.js": enc("y") });
    const entries = listZip(z, PACKAGE_LIMITS);
    expect(entries.every((e) => !e.safePath)).toBe(true);
    expect(() => readZipEntries(z, entries, PACKAGE_LIMITS)).toThrow(expect.objectContaining({ code: "unsafe-path" }));
  });

  it("refuses names that collide ignoring case", () => {
    const z = zipSync({ "A.js": enc("1"), "a.js": enc("2") });
    expect(() => unzipAll(z)).toThrow(expect.objectContaining({ code: "duplicate-path" }));
  });
});

describe("assemblePackage + readPackage", () => {
  it("builds a package that reads back verified", async () => {
    const p = await pkg();
    const loaded = await readPackage(p.bytes, { trustedManifestDigests: new Set([p.manifestDigest]) });
    expect(loaded.manifest.id).toBe("example-game");
    expect(loaded.manifestDigest).toBe(p.manifestDigest);
    expect([...loaded.files.keys()].sort()).toEqual(["assets/w.js", "game.html"]);
    expect(loaded.manifest.files["game.html"].sha256).toBe(await sha256Hex(GAME[0].data));
    expect(loaded.manifest.build?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", async () => {
    expect((await pkg()).bytes).toEqual((await pkg()).bytes);
  });

  it("refuses to write an invalid manifest", async () => {
    await expect(pkg({ id: "Bad Id" })).rejects.toThrow(/invalid package/);
  });

  async function expectCode(bytes: Uint8Array, code: string, trusted?: Set<string>) {
    const err = await readPackage(bytes, trusted ? { trustedManifestDigests: trusted } : {}).catch((e) => e);
    expect(err).toBeInstanceOf(PackageError);
    expect(err.code).toBe(code);
    return err as PackageError;
  }

  it("refuses an untrusted package", async () => {
    const p = await pkg();
    await expectCode(p.bytes, "untrusted", new Set(["0".repeat(64)]));
  });

  it("detects a hash mismatch when a file is swapped but the manifest kept", async () => {
    const p = await pkg();
    const files = unzipAll(p.bytes);
    files["game.html"] = enc("<!doctype html><title>y</title><canvas></canvas>"); // same length
    await expectCode(rezip(files), "hash-mismatch");
  });

  it("detects a size mismatch", async () => {
    const p = await pkg();
    const files = unzipAll(p.bytes);
    files["game.html"] = enc("<!doctype html>");
    await expectCode(rezip(files), "size-mismatch");
  });

  it("detects missing assets and unlisted extras", async () => {
    const p = await pkg();
    const missing = unzipAll(p.bytes);
    delete missing["assets/w.js"];
    await expectCode(rezip(missing), "missing-file");
    const extra = unzipAll(p.bytes);
    extra["assets/extra.js"] = enc("x");
    await expectCode(rezip(extra), "unexpected-file");
  });

  it("reports a missing manifest and an invalid one", async () => {
    await expectCode(rezip({ "game.html": enc("x") }), "missing-manifest");
    const p = await pkg();
    const files = unzipAll(p.bytes);
    files["manifest.json"] = enc('{"format":"hpg"}');
    const err = await expectCode(rezip(files), "invalid-manifest");
    expect(err.details.length).toBeGreaterThan(3);
  });

  it("refuses a manifest that was edited (even validly) when trust is enforced", async () => {
    const p = await pkg();
    const files = unzipAll(p.bytes);
    const m = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    m.name = "Renamed";
    files["manifest.json"] = enc(JSON.stringify(m));
    await expectCode(rezip(files), "untrusted", new Set([p.manifestDigest]));
  });

  it("distinguishes version incompatibility from invalidity", async () => {
    const tooOld = await pkg({ minimumLauncherVersion: "9.0.0" });
    await expectCode(tooOld.bytes, "launcher-too-old");
    const p = await pkg();
    const files = unzipAll(p.bytes);
    const m = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    m.formatVersion = 2;
    files["manifest.json"] = enc(JSON.stringify(m));
    await expectCode(rezip(files), "format-too-new");
  });

  it("refuses unsupported entry types at validation", async () => {
    await expect(
      assemblePackage(base({ entry: "game.swf" }), [{ path: "game.swf", data: enc("x"), role: "entry" }]),
    ).rejects.toThrow(/unsupported entry type/);
  });

  it("reports a corrupt archive", async () => {
    const p = await pkg();
    await expectCode(p.bytes.subarray(0, p.bytes.length - 10), "corrupt-archive");
  });

  it("supports a real WebAssembly module (runtime wasm)", async () => {
    // (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
    const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11]);
    const p = await assemblePackage(base({ runtime: "wasm" }), [GAME[0], { path: "wasm/add.wasm", data: wasm, role: "wasm" }]);
    const loaded = await readPackage(p.bytes);
    const bytes = loaded.files.get("wasm/add.wasm")!;
    const instance = await WebAssembly.instantiate(await WebAssembly.compile(bytes.slice().buffer));
    expect((instance.exports.add as (a: number, b: number) => number)(2, 3)).toBe(5);
  });
});

describe("importSources", () => {
  it("imports a games.zip with nested folders, ignoring archiver noise", async () => {
    const a = await pkg({ id: "alpha" });
    const b = await pkg({ id: "beta" });
    const games = writeZip([
      { path: "games/alpha.hpg", data: a.bytes, level: 0 },
      { path: "games/beta.hpg", data: b.bytes, level: 0 },
      { path: "README.txt", data: enc("hi") },
    ]);
    const withNoise = zipSync({
      ...Object.fromEntries(Object.entries(unzipCollection(games)).map(([k, v]) => [k, v])),
      "__MACOSX/._alpha.hpg": enc("junk"),
    });
    const progress: number[] = [];
    const r = await importSources([{ name: "games.zip", bytes: withNoise }], {}, (d) => progress.push(d));
    expect(r.packages.map((p) => p.manifest.id).sort()).toEqual(["alpha", "beta"]);
    expect(r.items.filter((i) => i.status === "skipped").map((i) => i.source)).toEqual(["games.zip › README.txt"]);
    expect(progress.at(-1)).toBe(2);
  });

  function unzipCollection(bytes: Uint8Array) {
    const entries = listZip(bytes, PACKAGE_LIMITS);
    return Object.fromEntries(readZipEntries(bytes, entries, PACKAGE_LIMITS));
  }

  it("keeps the valid packages of a partially invalid archive", async () => {
    const a = await pkg({ id: "alpha" });
    const broken = a.bytes.slice(0, a.bytes.length - 40);
    const games = writeZip([
      { path: "alpha.hpg", data: a.bytes, level: 0 },
      { path: "broken.hpg", data: broken, level: 0 },
    ]);
    const r = await importSources([{ name: "games.zip", bytes: games }]);
    expect(r.packages.map((p) => p.manifest.id)).toEqual(["alpha"]);
    expect(r.items.find((i) => i.source.endsWith("broken.hpg"))).toMatchObject({ status: "error", code: "corrupt-archive" });
  });

  it("keeps the highest version among duplicate ids", async () => {
    const v1 = await pkg({ id: "alpha", version: "1.0.0" });
    const v2 = await pkg({ id: "alpha", version: "1.1.0" });
    const r = await importSources([
      { name: "old.hpg", bytes: v1.bytes },
      { name: "new.hpg", bytes: v2.bytes },
    ]);
    expect(r.packages).toHaveLength(1);
    expect(r.packages[0].manifest.version).toBe("1.1.0");
    expect(r.items.find((i) => i.source === "old.hpg")).toMatchObject({ status: "duplicate", keptVersion: "1.1.0" });
  });

  it("imports a single .hpg directly and enforces trust per package", async () => {
    const a = await pkg({ id: "alpha" });
    const b = await pkg({ id: "beta" });
    const r = await importSources(
      [{ name: "alpha.hpg", bytes: a.bytes }, { name: "beta.hpg", bytes: b.bytes }],
      { trustedManifestDigests: new Set([a.manifestDigest]) },
    );
    expect(r.packages.map((p) => p.manifest.id)).toEqual(["alpha"]);
    expect(r.items.find((i) => i.source === "beta.hpg")).toMatchObject({ status: "error", code: "untrusted" });
  });

  it("reports non-zip input and a .hpg with no manifest clearly", async () => {
    const r = await importSources([
      { name: "games.zip", bytes: enc("this is not a zip file at all......") },
      { name: "photo.jpg", bytes: enc("x") },
      { name: "fake.hpg", bytes: rezip({ "x.txt": enc("x") }) },
    ]);
    expect(r.packages).toEqual([]);
    expect(r.items.find((i) => i.source === "games.zip")).toMatchObject({ status: "error", code: "not-zip" });
    expect(r.items.find((i) => i.source === "photo.jpg")).toMatchObject({ status: "skipped" });
    expect(r.items.find((i) => i.source === "fake.hpg")).toMatchObject({ status: "error", code: "missing-manifest" });
  });

  it("refuses a bomb inside the collection without losing the others", async () => {
    const a = await pkg({ id: "alpha" });
    const bomb = deflateSync(new Uint8Array(20_000_000));
    expect(bomb.length).toBeLessThan(100_000);
    const games = writeZip([
      { path: "alpha.hpg", data: a.bytes, level: 0 },
      { path: "bomb.hpg", data: new Uint8Array(20_000_000) },
    ]);
    const r = await importSources([{ name: "games.zip", bytes: games }]);
    expect(r.packages.map((p) => p.manifest.id)).toEqual(["alpha"]);
    expect(r.items.find((i) => i.source.endsWith("bomb.hpg"))).toMatchObject({ status: "error", code: "suspicious-ratio" });
  });
});
