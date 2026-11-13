/**
 * The games that can be packaged for the Offline Arcade, one adapter each.
 *
 * Add a game here only after reading its code (docs/offline-arcade-games.md).
 * Mark it `verified` only after `npm run hpg:e2e` has played it from a
 * `file://` launcher with the network blocked. Verified games are the only
 * ones offered on /offline-arcade. The three below passed in Chrome 157 on
 * 14 November 2026 (results: docs/offline-arcade-design.md §7).
 */

import type { GameAdapter } from "./src/build/adapter";

export const adapters: GameAdapter[] = [
  {
    // Vite build: module entry, a lazily imported simulation chunk, a module
    // worker with an on-page fallback, a stylesheet, the SDK and saved settings.
    id: "conquest",
    version: "1.0.0",
    status: "verified",
    inputs: ["mouse", "touch", "keyboard"],
    display: { orientation: "landscape" },
    // Settings and records live in localStorage (conquest.settings.v1,
    // conquest.records.v1). Its "Reload" button (error screen only) restarts the
    // session from the latest save; its fullscreen button toggles the player.
    saves: true,
    workers: /^assets\/worker-[A-Za-z0-9_-]+\.js$/,
  },
  {
    // One inline-script canvas game: SDK scores, best score in localStorage
    // (neonTetherHS_v2), Web Audio. Desktop-only on the site, so no touch.
    id: "neon-tether",
    version: "1.0.0",
    status: "verified",
    inputs: ["keyboard", "mouse"],
    saves: true,
  },
  {
    // One inline-script canvas survivor game: SDK scores, saved progress in
    // localStorage (aethelgard_save), Web Audio, touch controls.
    id: "depths-of-aethelgard",
    version: "1.0.0",
    status: "verified",
    inputs: ["keyboard", "mouse", "touch"],
    saves: true,
  },
  {
    // Three.js (vendored in lib/three) 3D horror, ES modules. Models, textures,
    // audio and fonts load by relative path from assets/ (~12 MB). Solo only
    // offline: co-op needs the P2P network. STAGED, so the deploy never packages
    // it; try it with `npm run hpg:lab -- --source last-bell=../last-bell`.
    id: "last-bell",
    version: "0.1.0",
    status: "experimental",
    inputs: ["keyboard", "mouse"],
    display: { orientation: "landscape" },
    saves: true,
    // First-person mouse look (the frame gets allow-pointer-lock, nothing else).
    permissions: ["pointer-lock"],
    assets: /^assets\/(?:[^/.][^/]*\/)*[^/.][^/]*$/,
    notes: ["Solo only: co-op needs an internet connection."],
  },
];
