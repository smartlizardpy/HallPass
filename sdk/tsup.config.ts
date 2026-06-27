import { existsSync, renameSync } from "node:fs";
import { defineConfig } from "tsup";

const OUT_DIR = "public/sdk/v1";

/**
 * Builds the browser SDK into a single dependency-free IIFE served statically
 * from `/sdk/v1/hallpass.js`. Games are raw HTML, so the artifact must run as a
 * side-effecting `<script>` that attaches `window.HallPass` — not an ESM import.
 *
 * Paths are relative to the repo root (npm scripts run from there), NOT to this
 * config file. Invoke via `npm run build:sdk` (`tsup --config sdk/tsup.config.ts`).
 *
 * `clean: false` so we never wipe other versioned artifacts under public/sdk.
 */
export default defineConfig({
  entry: { hallpass: "sdk/src/index.ts" },
  outDir: OUT_DIR,
  format: ["iife"],
  platform: "browser",
  target: "es2017",
  minify: true,
  sourcemap: false,
  dts: false,
  clean: false,
  banner: {
    js: "/* HallPass Scoreboard SDK v1 — https://hallpass.gg/llms.txt — never throws, never blocks the game. */",
  },
  // tsup names the IIFE bundle `hallpass.global.js`, but the stable URL contract
  // (and the integration snippet) reference `/sdk/v1/hallpass.js`. Rename to the
  // canonical name after every build (runs in watch mode and on Vercel prebuild).
  onSuccess: async () => {
    const from = `${OUT_DIR}/hallpass.global.js`;
    const to = `${OUT_DIR}/hallpass.js`;
    if (existsSync(from)) renameSync(from, to);
  },
});
