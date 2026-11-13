/**
 * `npm run hpg:arcade`: everything the website needs to offer offline
 * arcades, written to `public/arcade/` (gitignored, rebuilt on every deploy).
 *
 *   public/arcade/packages/<id>-<version>-<hash>.hpg   one per VERIFIED adapter that built
 *   public/arcade/index.html                           the launcher, trusting exactly those
 *   public/arcade/catalog.json                         what /offline-arcade lists
 *
 * Runs in `prebuild`, after the games manifest is built, so packages match the game files the
 * deploy ships. A game that fails to package is left out with a CI warning, and
 * the deploy goes on: the offline arcade must never block the site. The catalog
 * lists only what was actually built, so it cannot promise a package that does
 * not exist.
 *
 * The website composes a player's download from these static files in the
 * browser. Nothing here runs per request.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LAUNCHER_VERSION } from "../format/constants";
import type { GameAdapter } from "./adapter";
import { buildLauncherHtml, type TrustList } from "./launcher";
import { packageGame, type CatalogGame } from "./packager";

export type ArcadeCatalogGame = {
  id: string;
  name: string;
  description: string;
  category: string | null;
  version: string;
  /** Path under /arcade/, e.g. "packages/conquest-1.0.0-bc112359.hpg". */
  file: string;
  size: number;
  /** sha256 of the .hpg file, checked by the website before zipping. */
  sha256: string;
  manifestDigest: string;
  status: GameAdapter["status"];
};

export type ArcadeCatalog = {
  format: "hpg-arcade-catalog";
  version: 1;
  available: boolean;
  launcherVersion: string;
  launcher: { file: string; size: number; sha256: string } | null;
  games: ArcadeCatalogGame[];
};

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

export type ArcadeLog = (line: string) => void;

export async function buildArcade(
  repoRoot: string,
  adapters: readonly GameAdapter[],
  catalog: readonly CatalogGame[],
  log: ArcadeLog = console.log,
  /** Local testing only (`hpg arcade --include-experimental`); never in prebuild. */
  includeExperimental = false,
): Promise<ArcadeCatalog> {
  const outDir = path.join(repoRoot, "public", "arcade");
  const pkgDir = path.join(outDir, "packages");
  mkdirSync(pkgDir, { recursive: true });
  // Only .hpg files are ever deleted here, and only in our own folder.
  for (const name of readdirSync(pkgDir)) if (name.endsWith(".hpg")) rmSync(path.join(pkgDir, name));

  const games: ArcadeCatalogGame[] = [];
  const trust: TrustList = { packages: [] };
  for (const adapter of adapters) {
    // Only games that passed the real-browser e2e are offered (hpg/games.config.ts).
    if (adapter.status !== "verified" && !includeExperimental) {
      log(`[arcade] ${adapter.id} skipped: status is ${adapter.status}, not verified`);
      continue;
    }
    let r;
    try {
      r = await packageGame(repoRoot, adapter, catalog);
    } catch (e) {
      r = { ok: false as const, id: adapter.id, issues: [{ level: "error" as const, message: e instanceof Error ? e.message : String(e) }] };
    }
    if (!r.ok) {
      const why = r.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ");
      log(`::warning::offline arcade: ${adapter.id} was not packaged: ${why}`);
      continue;
    }
    writeFileSync(path.join(pkgDir, r.fileName), r.bytes);
    trust.packages.push({ id: r.manifest.id, version: r.manifest.version, manifestDigest: r.manifestDigest });
    games.push({
      id: r.manifest.id,
      name: r.manifest.name,
      description: r.manifest.description,
      category: r.manifest.category ?? null,
      version: r.manifest.version,
      file: `packages/${r.fileName}`,
      size: r.bytes.length,
      sha256: sha256(r.bytes),
      manifestDigest: r.manifestDigest,
      status: adapter.status,
    });
    log(`[arcade] ${adapter.id} → packages/${r.fileName} (${(r.bytes.length / 1024).toFixed(1)} KB, ${adapter.status})`);
  }

  let launcher: ArcadeCatalog["launcher"] = null;
  try {
    const html = await buildLauncherHtml(path.join(repoRoot, "hpg", "src"), trust);
    writeFileSync(path.join(outDir, "index.html"), html);
    launcher = { file: "index.html", size: Buffer.byteLength(html), sha256: sha256(html) };
    log(`[arcade] launcher → index.html (${(html.length / 1024).toFixed(1)} KB, trusts ${trust.packages.length})`);
  } catch (e) {
    log(`::warning::offline arcade: the launcher failed to build, so /offline-arcade is unavailable: ${e instanceof Error ? e.message : String(e)}`);
    if (existsSync(path.join(outDir, "index.html"))) rmSync(path.join(outDir, "index.html"));
  }

  const out: ArcadeCatalog = {
    format: "hpg-arcade-catalog",
    version: 1,
    available: launcher !== null && games.length > 0,
    launcherVersion: LAUNCHER_VERSION,
    launcher,
    games: games.sort((a, b) => a.name.localeCompare(b.name)),
  };
  writeFileSync(path.join(outDir, "catalog.json"), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
