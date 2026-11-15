#!/usr/bin/env node
// Runs the HPG CLI (hpg/src/cli/main.ts).
//
// The CLI is TypeScript and imports the site catalogue (app/lib/games.ts), so
// it is bundled with esbuild into node_modules/.cache/hpg/ and then imported.
// Dependencies (esbuild, jsdom, sharp, fflate) stay external and load from
// node_modules. Bundling takes well under a second and avoids relying on Node's
// type stripping, which does not accept this repo's extensionless TS imports.
//
// Usage: npm run hpg -- <command> [args]   (or the hpg:* shortcuts in package.json)

import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "node_modules/.cache/hpg");
const outfile = resolve(outDir, "cli.mjs");
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [resolve(root, "hpg/src/cli/main.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  logLevel: "warning",
  // The bundle imports browser modules too (the guest runtime source, for the
  // launcher build); they are plain TS and bundle fine for Node.
});

const { main } = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
process.exitCode = await main(process.argv.slice(2));
