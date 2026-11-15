/**
 * The games that can be packaged for the Offline Arcade, one adapter each.
 *
 * Add a game here only after reading its code (docs/offline-arcade-games.md).
 * Verified games are the only ones offered on /offline-arcade. A game may be
 * marked `verified` after EITHER
 *   - the full e2e (`npm run hpg:e2e`, hpg/e2e/run.mjs) played it from a
 *     `file://` launcher with the network blocked: the first three below, in
 *     Chrome 157 on 14 November 2026 (docs/offline-arcade-design.md §7); OR
 *   - a smoke PASS (`npm run hpg:smoke`: starts, draws, reacts, no errors, no
 *     network) AND a person playing it in the lab arcade (`npm run hpg:lab`):
 *     the "smoke + playtest" block below, 14 November 2026.
 *
 * The later blocks (15 November 2026) were added at the site owner's request
 * to offer every game that packages. Each is labelled with what the smoke test
 * actually showed; none was played end to end by the test.
 */

import { GOOGLE_FONT_HOSTS, type GameAdapter } from "./src/build/adapter";

/** A smoke-tested, playtested single-file game; fonts fall back offline. */
function simple(id: string, inputs: GameAdapter["inputs"], extra: Partial<GameAdapter> = {}): GameAdapter {
  return { id, version: "1.0.0", status: "verified", inputs, dropRemoteHosts: GOOGLE_FONT_HOSTS, ...extra };
}

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

  // ---- smoke + playtest (14 November 2026). Inputs are what each game's code
  // listens for; games the site marks desktop-only list no touch, as above.
  // `saves` where the game keeps progress or records in localStorage.
  simple("battlebadlers", ["keyboard", "mouse", "touch"]),
  simple("core-vs-swarm", ["mouse"]),
  simple("crimson-survivor", ["keyboard", "mouse"]),
  simple("doodle-dash", ["keyboard", "mouse", "touch"], { saves: true }),
  simple("jjk-domain-survival-top-down", ["keyboard", "mouse"]),
  simple("jjk-domain-survival-v3", ["keyboard"]),
  simple("neon-fracture", ["keyboard", "mouse"]),
  simple("neon-hockey", ["keyboard", "mouse"], { saves: true }),
  simple("neon-well", ["keyboard", "mouse", "touch"]),
  // Vite build: module entry and stylesheet under assets/, MIT notices kept.
  simple("ragdoll-hoops", ["keyboard", "mouse", "touch"], { saves: true }),
  simple("sea-mercenary", ["keyboard", "mouse"]),
  simple("silence", ["keyboard", "mouse"]),
  simple("snag", ["keyboard"]),
  simple("vanta-void", ["keyboard", "mouse"]),

  // ---- smoke PASS, 15 November 2026 (Chrome 157, network off). Games that load
  // Tailwind, three.js or Font Awesome from a CDN get the pinned copy in
  // hpg/vendor/ (build/vendor.ts). Staged in games.ts but published from the
  // dashboard, so the deploy's database read offers them.
  simple("color-clash-3d", ["keyboard", "mouse"]),
  simple("cube-clash-3d", ["keyboard", "mouse"]),
  simple("cyber-pulse-3d-neon-dash", ["keyboard", "mouse", "touch"], { saves: true }),
  simple("living-flesh", ["keyboard", "mouse", "touch"], { saves: true }),
  simple("neon-snake", ["keyboard", "mouse", "touch"], { saves: true }),
  simple("neon-velocity-hyperdrive", ["keyboard", "mouse"]),
  simple("paddle-crawler", ["keyboard", "mouse"]),
  simple("rhythm-hell-harmonic-flash", ["keyboard", "mouse"]),
  simple("scp-lockdown", ["keyboard", "mouse", "touch"], { saves: true, permissions: ["pointer-lock"] }),
  simple("shadow-core-halloween-dash", ["keyboard", "mouse", "touch"], { saves: true }),
  simple("survive-till-dawn-pixel-edition", ["keyboard", "mouse", "touch"], { saves: true }),
  simple("symbiosis", ["mouse"]),
  simple("system-error", ["keyboard", "mouse"]),
  simple("vanishing-point-3-14", ["keyboard", "mouse", "touch"], { saves: true, permissions: ["pointer-lock"] }),
  // Ran and reacted; its remote sound clips are blocked offline and the game
  // falls back to its own synthesised sounds (by design, see its AUDIO block).
  simple("duskfall", ["keyboard", "mouse"], {
    saves: true,
    permissions: ["pointer-lock"],
    notes: ["Offline it uses synthesised sound effects instead of recorded ones."],
  }),

  // ---- smoke CHECK, 15 November 2026: loads and draws its start screen with
  // no errors and no network, but the generic input cannot get past it (a class
  // to pick, a code, a boot sequence). Play each once in the lab.
  simple("chroma-orbit", ["keyboard", "mouse"]),
  simple("customizable-os", ["keyboard", "mouse"], { saves: true }),
  simple("nuclear-reactor-manager", ["keyboard", "mouse"]),
  simple("pixel-bullet-quest", ["keyboard", "mouse"]),
  simple("pixel-slicer", ["mouse", "touch"]),
  simple("system-restore", ["mouse"], { saves: true }),
  simple("teraria", ["keyboard", "mouse"], { saves: true }),

  {
    // Three.js (vendored in lib/three) 3D horror, ES modules. Models, textures,
    // audio and fonts load by relative path from assets/ (~12 MB). Solo only
    // offline: co-op needs the P2P network. Playtested solo in the lab
    // (14 November 2026); headless Chrome cannot pointer-lock, so the smoke test
    // only shows it loading. Its /api/v1/me request fails offline, as expected.
    id: "last-bell",
    version: "0.1.0",
    status: "verified",
    inputs: ["keyboard", "mouse"],
    display: { orientation: "landscape" },
    saves: true,
    // First-person mouse look (the frame gets allow-pointer-lock, nothing else).
    permissions: ["pointer-lock"],
    assets: /^assets\/(?:[^/.][^/]*\/)*[^/.][^/]*$/,
    notes: ["Solo only: co-op needs an internet connection."],
  },
];
