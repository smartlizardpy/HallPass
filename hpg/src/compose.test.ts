import { readFileSync } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { listZip, readZipEntries } from "./archive/zip";
import { COLLECTION_LIMITS } from "./format/constants";
import type { ArcadeCatalog } from "./build/arcade";
import { ComposeError, composeArcade, DOWNLOAD_FOLDER, estimateBytes, readmeText } from "./compose";
import { sha256Hex } from "./format/hash";

const enc = (s: string) => new TextEncoder().encode(s);

async function fixture() {
  const files: Record<string, Uint8Array> = {
    "index.html": enc("<!DOCTYPE html><title>launcher</title>"),
    "packages/a-1.0.0-aaaaaaaa.hpg": enc("package a"),
    "packages/b-1.0.0-bbbbbbbb.hpg": enc("package b"),
  };
  const game = async (id: string, name: string, file: string) => ({
    id,
    name,
    description: "",
    category: null,
    version: "1.0.0+aaaaaaaa",
    file,
    size: files[file].length,
    sha256: await sha256Hex(files[file]),
    manifestDigest: "0".repeat(64),
    status: "verified" as const,
  });
  const catalog: ArcadeCatalog = {
    format: "hpg-arcade-catalog",
    version: 1,
    available: true,
    launcherVersion: "1.0.0",
    launcher: { file: "index.html", size: files["index.html"].length, sha256: await sha256Hex(files["index.html"]) },
    games: [await game("a", "Alpha", "packages/a-1.0.0-aaaaaaaa.hpg"), await game("b", "Beta", "packages/b-1.0.0-bbbbbbbb.hpg")],
  };
  const fetched: string[] = [];
  const fetcher = async (p: string) => {
    fetched.push(p);
    return files[p];
  };
  return { files, catalog, fetcher, fetched };
}

describe("composeArcade", () => {
  it("zips the launcher, the chosen packages and a README into one folder", async () => {
    const { catalog, fetcher, fetched } = await fixture();
    const progress: number[] = [];
    const zip = await composeArcade(catalog, new Set(["b"]), fetcher, "14 November 2026", (n) => progress.push(n));
    expect(fetched).toEqual(["index.html", "packages/b-1.0.0-bbbbbbbb.hpg"]);
    expect(progress).toEqual([0, 1, 2]);
    // The outer ZIP is opened by the player's OS, not the arcade (its folder
    // name has a space, which the package path grammar rightly refuses).
    const outer = unzipSync(zip);
    expect(Object.keys(outer)).toEqual([`${DOWNLOAD_FOLDER}/index.html`, `${DOWNLOAD_FOLDER}/games.zip`, `${DOWNLOAD_FOLDER}/README.txt`]);
    // games.zip IS read by the arcade, with its own strict reader.
    const games = outer[`${DOWNLOAD_FOLDER}/games.zip`];
    const inner = readZipEntries(games, listZip(games, COLLECTION_LIMITS), COLLECTION_LIMITS);
    expect([...inner.keys()]).toEqual(["b-1.0.0-bbbbbbbb.hpg"]);
    expect(new TextDecoder().decode(outer[`${DOWNLOAD_FOLDER}/README.txt`])).toContain("  - Beta");
  });

  it("is deterministic", async () => {
    const { catalog, fetcher } = await fixture();
    const ids = new Set(["a", "b"]);
    const one = await composeArcade(catalog, ids, fetcher, "today");
    const two = await composeArcade(catalog, ids, fetcher, "today");
    expect(Buffer.from(one).equals(Buffer.from(two))).toBe(true);
  });

  it("refuses a file that does not match the catalog", async () => {
    const { catalog, files } = await fixture();
    const fetcher = async (p: string) => (p.endsWith("a-1.0.0-aaaaaaaa.hpg") ? enc("tampered") : files[p]);
    await expect(composeArcade(catalog, new Set(["a"]), fetcher, "today")).rejects.toThrow(ComposeError);
  });

  it("refuses an empty selection and an unavailable catalog", async () => {
    const { catalog, fetcher } = await fixture();
    await expect(composeArcade(catalog, new Set(), fetcher, "today")).rejects.toThrow(/no games/);
    await expect(composeArcade({ ...catalog, available: false }, new Set(["a"]), fetcher, "today")).rejects.toThrow(/not available/);
  });

  it("estimates the size from the catalog", async () => {
    const { catalog } = await fixture();
    expect(estimateBytes(catalog, new Set(["a", "b"]))).toBeGreaterThan(estimateBytes(catalog, new Set(["a"])));
  });

  it("writes a README with Windows line endings", () => {
    expect(readmeText([{ name: "X" }], "today")).toContain("\r\n  - X\r\n");
  });
});

describe("service worker", () => {
  it("never caches /arcade/ (its launcher embeds a per-deploy trust list)", () => {
    const sw = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
    expect(sw).toContain('url.pathname.startsWith("/arcade/")');
  });
});
