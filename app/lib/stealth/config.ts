/**
 * HallPass — stealth-mode configuration (pure data, no `window`).
 *
 * Kept separate from {@link file://./store.ts} so the panic-screen catalogue and
 * the preference defaults can be imported by the React components AND unit-tested
 * without pulling in the localStorage store. Mirrors the repo's existing
 * per-feature `config.ts` convention (scoreboard, achievements, beta).
 *
 * It imports `cloaks.ts` (itself import-free) so a panic screen and the tab cloak
 * impersonating the same product share one favicon. Nothing here reaches back the
 * other way, so the two stay acyclic and both remain safe for the server-rendered
 * boot script to pull from.
 */

import { cloakById } from "./cloaks";

/**
 * localStorage key holding the JSON-encoded stealth prefs. Lives here (not in the
 * `"use client"` store) so the server-rendered boot script and the client store
 * share ONE literal — a drift between them would apply the cloak from the wrong key.
 */
export const STEALTH_KEY = "hp:stealth";

/**
 * The fake screens the panic key can throw up over the arcade.
 *
 * Each entry carries the TAB the disguise implies as well as the screen itself.
 * A recreated Google Doc filling the viewport above a tab strip still reading
 * "HALLPASS — Unblocked Games" is not a disguise, it is a confession — so the
 * fake screen and the fake tab have to come from one record, or they drift the
 * first time either is edited alone.
 *
 * The favicon is borrowed from the cloak preset of the same name rather than
 * redrawn here: both are pretending to be the same product, and one 16px icon
 * per product is the whole point of a single source of truth. The `title`s stay
 * spelled out because a screen's tab caption is a property of the SCREEN — a
 * disguise could plausibly want a caption its cloak twin does not.
 *
 * `chrome` is the colour of the disguise's TOP CHROME, and it exists for the two
 * strips of a phone that no amount of markup inside the screen can reach: the
 * safe-area inset behind a notch, and the status bar of the installed PWA (whose
 * default is the arcade's neon purple — a violently obvious tell above an
 * otherwise convincing document). All three impersonate white-chromed surfaces,
 * so these are near-identical by nature rather than by coincidence; a screen that
 * grew a coloured header would change its own value here.
 */
export const PANIC_SCREENS = [
  {
    id: "docs",
    label: "Google Docs",
    title: "Untitled document - Google Docs",
    favicon: cloakById("docs").favicon,
    chrome: "#f9fbfd",
  },
  {
    id: "classroom",
    label: "Google Classroom",
    title: "Classes",
    favicon: cloakById("classroom").favicon,
    chrome: "#ffffff",
  },
  {
    id: "search",
    label: "Google Search",
    title: "Google",
    favicon: cloakById("search").favicon,
    chrome: "#ffffff",
  },
] as const;

export type PanicScreenId = (typeof PANIC_SCREENS)[number]["id"];
export type PanicScreen = (typeof PANIC_SCREENS)[number];

/** Whether `id` names a known panic screen (guards a stale localStorage value). */
export function isPanicScreen(id: string): id is PanicScreenId {
  return PANIC_SCREENS.some((s) => s.id === id);
}

/** Default fake screen — a blank Google Doc is the least conspicuous. */
export const DEFAULT_PANIC_SCREEN: PanicScreenId = "docs";

/**
 * Resolve an id to its screen record, falling back to the default rather than
 * returning `undefined` — a stale stored id must still produce a real disguise,
 * because the moment it is read is the moment the player needed one.
 */
export function panicScreenById(id: string | null | undefined): PanicScreen {
  return PANIC_SCREENS.find((s) => s.id === id) ?? PANIC_SCREENS[0];
}

/**
 * Default panic hotkey. Backtick is deliberate: it sits outside WASD / arrows /
 * space, so it will not collide with the controls of a game running in the
 * player overlay. Compared against `KeyboardEvent.key`.
 */
export const DEFAULT_PANIC_KEY = "`";

/**
 * Whether shake-to-panic is on out of the box. OFF: it needs a motion-permission
 * grant on iOS and would otherwise raise the disguise from an accidental jolt, so
 * it is strictly opt-in from the settings modal.
 */
export const DEFAULT_SHAKE_TO_PANIC = false;
