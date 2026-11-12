/**
 * `npm run hpg -- <command>` — the HPG developer CLI.
 *
 *   build    --game <id> [--game <id>…] | --all   [--out <dir>]
 *   inspect  <file.hpg>                 manifest, files, sizes, digest
 *   validate <file.hpg>…                full verification; exit 1 on any failure
 *   audit    [--json]                   package-ability of every game
 *
 * Run through scripts/hpg.mjs, which bundles this file with esbuild first, so
 * it can import the TypeScript sources and `app/lib/games.ts` directly.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { publicGames } from "../../../app/lib/games";
import { adapters } from "../../games.config";
import { PackageError, readPackage } from "../archive/package";
import { auditGames, auditMarkdown } from "../build/audit";
import type { BuildIssue } from "../build/inline";
import { packageGame, type CatalogGame } from "../build/packager";

const catalog: CatalogGame[] = publicGames as CatalogGame[];

function flagValues(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) out.push(args[++i]);
  return out;
}

function kb(n: number): string {
  return `${(n / 1024).toFixed(1)} KB`;
}

function printIssues(issues: BuildIssue[], verbose: boolean) {
  for (const i of issues) {
    if (i.level === "info" && !verbose) continue;
    const tag = i.level === "error" ? "  ✗" : i.level === "warning" ? "  !" : "  ·";
    console.log(`${tag} ${i.message}`);
  }
}

async function cmdBuild(args: string[], root: string): Promise<number> {
  const all = args.includes("--all");
  const ids = flagValues(args, "--game");
  const outDir = path.resolve(root, flagValues(args, "--out")[0] ?? "public/arcade/packages");
  const verbose = args.includes("--verbose");
  const chosen = all ? adapters : ids.map((id) => adapters.find((a) => a.id === id) ?? id);
  if (chosen.length === 0) {
    console.error("usage: hpg build --game <id> | --all");
    return 2;
  }
  mkdirSync(outDir, { recursive: true });
  let failures = 0;
  for (const a of chosen) {
    if (typeof a === "string") {
      console.log(`✗ ${a}: no adapter in hpg/games.config.ts`);
      failures++;
      continue;
    }
    const r = await packageGame(root, a, catalog);
    if (!r.ok) {
      console.log(`✗ ${a.id}: could not be packaged`);
      printIssues(r.issues, true);
      failures++;
      continue;
    }
    writeFileSync(path.join(outDir, r.fileName), r.bytes);
    console.log(`✓ ${a.id} → ${path.relative(root, path.join(outDir, r.fileName))} (${kb(r.bytes.length)}, ${Object.keys(r.manifest.files).length} files)`);
    printIssues(r.issues, verbose);
  }
  return failures ? 1 : 0;
}

async function cmdInspect(args: string[]): Promise<number> {
  const file = args[0];
  if (!file) {
    console.error("usage: hpg inspect <file.hpg>");
    return 2;
  }
  const bytes = new Uint8Array(readFileSync(file));
  try {
    const p = await readPackage(bytes);
    const m = p.manifest;
    console.log(`${m.name} (${m.id}) ${m.version}`);
    console.log(`  runtime ${m.runtime}, entry ${m.entry}, launcher ≥ ${m.minimumLauncherVersion}`);
    console.log(`  ${m.category ?? "—"} · inputs: ${(m.inputs ?? []).join(", ") || "—"} · permissions: ${m.permissions.join(", ") || "none"}`);
    console.log(`  features: ${JSON.stringify(m.features ?? {})}  compatibility: ${JSON.stringify(m.compatibility ?? {})}`);
    console.log(`  manifest sha256 ${p.manifestDigest}`);
    console.log(`  archive ${kb(bytes.length)}, unpacked ${kb(Object.values(m.files).reduce((s, f) => s + f.size, 0))}`);
    for (const [fp, f] of Object.entries(m.files)) console.log(`    ${f.role.padEnd(9)} ${kb(f.size).padStart(10)}  ${fp}`);
    return 0;
  } catch (e) {
    return reportPackageError(file, e);
  }
}

function reportPackageError(file: string, e: unknown): number {
  if (e instanceof PackageError) {
    console.log(`✗ ${file}: ${e.code}: ${e.message}`);
    for (const d of e.details) console.log(`    ${d}`);
  } else {
    console.log(`✗ ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return 1;
}

async function cmdValidate(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.error("usage: hpg validate <file.hpg>…");
    return 2;
  }
  let failures = 0;
  for (const file of args) {
    try {
      const p = await readPackage(new Uint8Array(readFileSync(file)));
      console.log(`✓ ${file}: ${p.manifest.id} ${p.manifest.version}, ${p.files.size} files verified`);
    } catch (e) {
      failures += reportPackageError(file, e);
    }
  }
  return failures ? 1 : 0;
}

async function cmdAudit(args: string[], root: string): Promise<number> {
  const rows = await auditGames(root, catalog, adapters);
  console.log(args.includes("--json") ? JSON.stringify(rows, null, 2) : auditMarkdown(rows));
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  const root = process.cwd();
  switch (cmd) {
    case "build":
      return cmdBuild(args, root);
    case "inspect":
      return cmdInspect(args);
    case "validate":
      return cmdValidate(args);
    case "audit":
      return cmdAudit(args, root);
    default:
      console.log("usage: hpg <build|inspect|validate|audit> …  (see hpg/src/cli/main.ts)");
      return cmd ? 2 : 0;
  }
}
