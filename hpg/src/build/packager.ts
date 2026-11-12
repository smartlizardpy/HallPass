/**
 * Build one game into one `.hpg`.
 *
 *   adapter + games.ts entry + public/games/<id>/
 *     → inline the entry (build/inline.ts)
 *     → rebuild workers as classic scripts, collect extra assets and notices
 *     → cover → 640px WebP
 *     → assemblePackage (hashes, manifest, validation, deterministic ZIP)
 *     → read it back with the launcher's own reader, as a final check
 *
 * Nothing is written unless every step succeeded. A failed build returns its
 * errors; it never produces a partial package.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { assemblePackage, type PackageFile } from "../archive/assemble";
import { readPackage } from "../archive/package";
import { LAUNCHER_VERSION, PACKAGER_VERSION } from "../format/constants";
import { sha256Hex } from "../format/hash";
import { isSafePackagePath } from "../format/paths";
import type { HpgManifest } from "../format/manifest";
import type { GameAdapter } from "./adapter";
import { bundle, inlineEntry, InlineReport, type BuildIssue } from "./inline";

/** The fields of a `games.ts` entry the packager reads. */
export type CatalogGame = {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  category: string;
  tags: string[];
  gradient: [string, string];
  accent: string;
  author?: string;
  staged?: boolean;
  externalUrl?: string;
};

export type PackageBuild =
  | {
      ok: true;
      id: string;
      fileName: string;
      bytes: Uint8Array;
      manifest: HpgManifest;
      manifestDigest: string;
      issues: BuildIssue[];
    }
  | { ok: false; id: string; issues: BuildIssue[] };

const NOTICE_RE = /^(THIRD-PARTY-NOTICES|LICENSE|LICENCE|NOTICE)(\.(txt|md))?$/i;
const MAX_DESCRIPTION = 600;

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

async function coverWebp(file: string, report: InlineReport): Promise<{ data: Uint8Array; path: string }> {
  try {
    const sharp = (await import("sharp")).default;
    const data = await sharp(readFileSync(file)).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    return { data: new Uint8Array(data), path: "cover.webp" };
  } catch (e) {
    report.warn(`cover kept as PNG: sharp is unavailable (${e instanceof Error ? e.message : String(e)})`);
    return { data: new Uint8Array(readFileSync(file)), path: "cover.png" };
  }
}

/** Code-level feature detection, for the manifest's informational compatibility flags. */
function detectFeatures(code: string) {
  return {
    webgl: /getContext\(\s*["'`](webgl2?|experimental-webgl)["'`]/.test(code) || /WebGLRenderer/.test(code),
    audio: /AudioContext|new Audio\(|HTMLAudioElement/.test(code),
  };
}

export async function packageGame(repoRoot: string, adapter: GameAdapter, catalog: readonly CatalogGame[]): Promise<PackageBuild> {
  const report = new InlineReport();
  const fail = (): PackageBuild => ({ ok: false, id: adapter.id, issues: report.issues });

  const game = catalog.find((g) => g.slug === adapter.id);
  if (!game) {
    report.error(`${adapter.id} is not a published game in app/lib/games.ts`);
    return fail();
  }
  if (game.staged) {
    report.error(`${adapter.id} is staged (beta only) and must never be packaged`);
    return fail();
  }
  if (game.externalUrl) {
    report.error(`${adapter.id} is hosted off-site and cannot be packaged`);
    return fail();
  }
  const gameDir = path.join(repoRoot, "public", "games", adapter.id);
  if (!existsSync(gameDir) || !statSync(gameDir).isDirectory()) {
    report.error(`public/games/${adapter.id}/ does not exist (run npm run sync-games?)`);
    return fail();
  }

  const entry = adapter.entry ?? "index.html";
  const inlined = await inlineEntry(gameDir, entry, adapter, report);
  if (!inlined || report.errors.length) return fail();

  const files: PackageFile[] = [{ path: "game.html", data: new TextEncoder().encode(inlined.html), role: "entry" }];
  const all = listFiles(gameDir);

  let hasWorkers = false;
  for (const rel of all.filter((p) => adapter.workers?.test(p))) {
    if (!isSafePackagePath(rel)) {
      report.error(`worker ${rel}: path is not package-safe`);
      continue;
    }
    if (!inlined.html.includes(path.posix.basename(rel))) {
      report.warn(`worker ${rel} is not referenced by the bundled entry; packaged anyway`);
    }
    const code = await bundle({ file: path.join(gameDir, rel) }, "iife", gameDir, rel, adapter, report);
    if (code === null) continue;
    files.push({ path: rel, data: new TextEncoder().encode(code), role: "worker" });
    hasWorkers = true;
    report.info(`worker ${rel} rebuilt as a classic worker`);
  }
  for (const rel of all.filter((p) => adapter.assets?.test(p))) {
    if (!isSafePackagePath(rel)) {
      report.error(`asset ${rel}: path is not package-safe`);
      continue;
    }
    files.push({ path: rel, data: new Uint8Array(readFileSync(path.join(gameDir, rel))), role: rel.endsWith(".wasm") ? "wasm" : "asset" });
  }
  for (const rel of all.filter((p) => NOTICE_RE.test(p))) {
    files.push({ path: rel, data: new Uint8Array(readFileSync(path.join(gameDir, rel))), role: "asset" });
  }

  let thumbnail: string | undefined;
  const coverPath = path.join(gameDir, "cover.png");
  if (existsSync(coverPath)) {
    const cover = await coverWebp(coverPath, report);
    files.push({ path: cover.path, data: cover.data, role: "thumbnail" });
    thumbnail = cover.path;
  } else {
    report.warn("no cover.png; the launcher will draw a generated card");
  }
  if (report.errors.length) return fail();

  const features = detectFeatures(inlined.html);
  const notes = [...(adapter.notes ?? [])];
  if (report.dropped.size > 0) notes.push("Uses your computer's fonts offline instead of its web font.");
  if (inlined.usesSdk) notes.push("Scores are kept on a leaderboard on this computer.");

  // Content hash first, so it can appear in the version as build metadata.
  const parts: string[] = [];
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) parts.push(`${f.path}\0${await sha256Hex(f.data)}`);
  const contentHash = await sha256Hex(parts.join("\n"));
  const short = contentHash.slice(0, 8);
  const hasWasm = files.some((f) => f.role === "wasm");

  const description = `${game.tagline.trim()}. ${game.description.trim()}`.replace(/\.\.\s/, ". ").slice(0, MAX_DESCRIPTION);
  let assembled;
  try {
    assembled = await assemblePackage(
      {
        format: "hpg",
        formatVersion: 1,
        id: adapter.id,
        name: game.title,
        version: `${adapter.version}+${short}`,
        description,
        entry: "game.html",
        runtime: hasWasm ? "wasm" : "html",
        offline: true,
        permissions: adapter.permissions ?? [],
        minimumLauncherVersion: LAUNCHER_VERSION,
        ...(thumbnail ? { thumbnail } : {}),
        category: game.category,
        tags: game.tags.slice(0, 12),
        ...(game.author ? { author: game.author } : {}),
        accent: game.accent,
        gradient: game.gradient,
        inputs: adapter.inputs,
        ...(adapter.display ? { display: adapter.display } : {}),
        compatibility: { webgl: features.webgl, workers: hasWorkers, audio: features.audio, ...(notes.length ? { notes } : {}) },
        features: { scores: inlined.usesSdk, saves: adapter.saves ?? false, scoreOrder: adapter.scoreOrder ?? "desc" },
        build: { packager: `hpg-packager/${PACKAGER_VERSION}`, source: `public/games/${adapter.id}` },
      },
      files,
    );
  } catch (e) {
    report.error(e instanceof Error ? e.message : String(e));
    return fail();
  }

  // Final check: the launcher's own reader must accept what was written.
  try {
    await readPackage(assembled.bytes, { trustedManifestDigests: new Set([assembled.manifestDigest]) });
  } catch (e) {
    report.error(`self-check failed: ${e instanceof Error ? e.message : String(e)}`);
    return fail();
  }

  return {
    ok: true,
    id: adapter.id,
    fileName: `${adapter.id}-${adapter.version}-${short}.hpg`,
    bytes: assembled.bytes,
    manifest: assembled.manifest,
    manifestDigest: assembled.manifestDigest,
    issues: report.issues,
  };
}
