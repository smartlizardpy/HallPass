/**
 * `npm run hpg:lab`: a LOCAL test arcade with every game in `public/games/`,
 * not just the verified ones, so each can be tried offline and smoke-tested
 * (`npm run hpg:smoke`, hpg/e2e/smoke.mjs) before anyone writes an adapter.
 *
 *   arcade-lab/                 gitignored; never deployed, never offered
 *     index.html                a launcher trusting every package below
 *     games.zip                 all of them, ready to drop on the launcher
 *     packages/*.hpg
 *     lab.json                  per game: built or blocked, and why
 *
 * Games with an adapter use it; the rest use the audit's permissive trial
 * adapter (build/audit.ts), so "builds here" means exactly what the audit's
 * "packageable" means.
 *
 * `sources` packages a game from a folder outside public/games/ (a game's own
 * working copy, e.g. `--source last-bell=../last-bell`), and staged games are
 * allowed here, so unreleased work can be tried offline. Both are lab-only
 * (packager PackageOptions); the deploy never packages either.
 *
 * Nothing in here makes a game `verified`: that still takes an adapter and the
 * full e2e (docs/offline-arcade-games.md).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { writeZip } from "../archive/zip";
import type { GameAdapter } from "./adapter";
import { gameIds, trialAdapter } from "./audit";
import { buildLauncherHtml, type TrustList } from "./launcher";
import { packageGame, type CatalogGame } from "./packager";

export type LabOptions = {
  /** Game id → folder to package it from instead of public/games/<id>/. */
  sources?: Record<string, string>;
};

export type LabGame = {
  id: string;
  name: string;
  /** `verified`/`experimental` from hpg/games.config.ts, or `trial` (no adapter yet). */
  adapter: GameAdapter["status"] | "trial";
  /** Packaged from a folder outside public/games/ (`--source`). */
  source?: string;
  staged?: boolean;
  built: boolean;
  file: string | null;
  sizeKb: number | null;
  /** Build errors when not built; warnings (dropped fonts, remote mentions) when built. */
  issues: string[];
};

export type LabReport = { builtAt: string; games: LabGame[] };

/**
 * The audit's trial adapter, plus pointer lock when the game's own code asks
 * for it (a first-person game is unplayable without it). Lab only: a real
 * adapter grants permissions explicitly, and the packager warns when one is
 * missing.
 */
function labTrialAdapter(id: string, dir: string): GameAdapter {
  const base = trialAdapter(id);
  const wantsLock = (d: string): boolean =>
    existsSync(d) &&
    readdirSync(d, { withFileTypes: true }).some((e) =>
      e.isDirectory()
        ? !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "_dev" && wantsLock(path.join(d, e.name))
        : /\.(html|m?js)$/.test(e.name) && readFileSync(path.join(d, e.name), "utf8").includes("requestPointerLock"),
    );
  return wantsLock(dir) ? { ...base, permissions: ["pointer-lock"] } : base;
}

export async function buildLab(
  repoRoot: string,
  adapters: readonly GameAdapter[],
  catalog: readonly CatalogGame[],
  outDir: string,
  log: (line: string) => void = console.log,
  options: LabOptions = {},
): Promise<LabReport> {
  const sources = options.sources ?? {};
  // Start clean so no stale package is trusted. The smoke report (report/) is
  // kept: it is dated, and a rebuild should not lose the last results.
  const pkgDir = path.join(outDir, "packages");
  if (existsSync(pkgDir)) rmSync(pkgDir, { recursive: true, force: true });
  mkdirSync(pkgDir, { recursive: true });

  const games: LabGame[] = [];
  const trust: TrustList = { packages: [] };
  const zipped: { path: string; data: Uint8Array; level: 0 }[] = [];
  for (const id of [...new Set([...gameIds(repoRoot), ...Object.keys(sources)])].sort()) {
    const known = adapters.find((a) => a.id === id);
    const adapter = known ?? labTrialAdapter(id, sources[id] ?? path.join(repoRoot, "public", "games", id));
    const entry = catalog.find((g) => g.slug === id);
    const name = entry?.title ?? id;
    let r;
    try {
      r = await packageGame(repoRoot, adapter, catalog, { gameDir: sources[id], allowStaged: true });
    } catch (e) {
      r = { ok: false as const, id, issues: [{ level: "error" as const, message: e instanceof Error ? e.message : String(e) }] };
    }
    const base = {
      id,
      name,
      adapter: known ? known.status : ("trial" as const),
      ...(sources[id] ? { source: sources[id] } : {}),
      ...(entry?.staged ? { staged: true } : {}),
    };
    if (!r.ok) {
      const errors = r.issues.filter((i) => i.level === "error").map((i) => i.message);
      games.push({ ...base, built: false, file: null, sizeKb: null, issues: errors });
      log(`✗ ${id}: ${errors[0] ?? "could not be packaged"}`);
      continue;
    }
    writeFileSync(path.join(pkgDir, r.fileName), r.bytes);
    zipped.push({ path: r.fileName, data: r.bytes, level: 0 });
    trust.packages.push({ id: r.manifest.id, version: r.manifest.version, manifestDigest: r.manifestDigest });
    const warnings = r.issues.filter((i) => i.level === "warning").map((i) => i.message);
    games.push({ ...base, name: r.manifest.name, built: true, file: `packages/${r.fileName}`, sizeKb: Math.round(r.bytes.length / 1024), issues: warnings });
    log(`✓ ${id} (${base.adapter}${base.staged ? ", staged" : ""}${base.source ? `, from ${base.source}` : ""}) ${(r.bytes.length / 1024).toFixed(1)} KB${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
  }

  writeFileSync(path.join(outDir, "index.html"), await buildLauncherHtml(path.join(repoRoot, "hpg", "src"), trust));
  writeFileSync(path.join(outDir, "games.zip"), writeZip(zipped));
  const report: LabReport = { builtAt: new Date().toISOString(), games };
  writeFileSync(path.join(outDir, "lab.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
