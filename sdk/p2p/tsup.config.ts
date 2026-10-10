import { defineConfig, type Options } from "tsup";
import { P2P_MAJOR, P2P_VERSION } from "./src/version";

const OUT_DIR = `public/sdk/p2p/v${P2P_MAJOR}`;

/**
 * Builds the P2P co-op SDK as ONE dependency-free ES module, served from
 * `/sdk/p2p/v1/` and meant to be vendored: a game copies `hallpass-p2p.js` (or
 * the `.min.js`) into its own folder and imports it with a relative path, no
 * build step needed. Unlike the scoreboard SDK (`sdk/tsup.config.ts`, an IIFE
 * that installs a global), this is an ES module with named exports.
 *
 * Outputs: hallpass-p2p.js (readable), hallpass-p2p.min.js, hallpass-p2p.d.ts.
 * Paths are relative to the repo root; run via `npm run build:sdk`.
 * `clean: false` so other files under public/sdk survive.
 */
const shared: Options = {
  outDir: OUT_DIR,
  format: ["esm"],
  platform: "browser",
  target: "es2020",
  sourcemap: false,
  clean: false,
  splitting: false,
  treeshake: true,
  outExtension: () => ({ js: ".js", dts: ".d.ts" }),
  banner: {
    js: `/* HallPass P2P SDK v${P2P_VERSION} — peer-to-peer co-op for HallPass games — https://hallpass.gg/sdk/p2p/v${P2P_MAJOR}/ — MIT */`,
  },
};

export default defineConfig([
  {
    ...shared,
    entry: { "hallpass-p2p": "sdk/p2p/src/index.ts" },
    minify: false,
    // The root tsconfig is the app's (incremental, Next plugin); the d.ts pass
    // only needs these overrides to emit one bundled declaration file.
    dts: { compilerOptions: { incremental: false, composite: false, noEmit: false } },
  },
  { ...shared, entry: { "hallpass-p2p.min": "sdk/p2p/src/index.ts" }, minify: true, dts: false },
]);
