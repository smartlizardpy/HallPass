/**
 * The games that can be packaged for the Offline Arcade, one adapter each.
 *
 * Add a game here only after reading its code (docs/offline-arcade-games.md).
 * Mark it `verified` only after `npm run hpg:e2e` has played it from a
 * `file://` launcher with the network blocked. Verified games are the only
 * ones offered on /offline-arcade.
 */

import type { GameAdapter } from "./src/build/adapter";

export const adapters: GameAdapter[] = [
  {
    // Vite build: module entry, a lazily imported simulation chunk, a module
    // worker with an on-page fallback, a stylesheet, the SDK and saved settings.
    id: "conquest",
    version: "1.0.0",
    status: "experimental",
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
    status: "experimental",
    inputs: ["keyboard", "mouse"],
    saves: true,
  },
  {
    // One inline-script canvas survivor game: SDK scores, saved progress in
    // localStorage (aethelgard_save), Web Audio, touch controls.
    id: "depths-of-aethelgard",
    version: "1.0.0",
    status: "experimental",
    inputs: ["keyboard", "mouse", "touch"],
    saves: true,
  },
];
