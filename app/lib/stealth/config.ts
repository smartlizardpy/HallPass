/**
 * HallPass — stealth-mode configuration (pure data, no `window`).
 *
 * Kept separate from {@link file://./store.ts} so the panic-screen catalogue and
 * the preference defaults can be imported by the React components AND unit-tested
 * without pulling in the localStorage store. Mirrors the repo's existing
 * per-feature `config.ts` convention (scoreboard, achievements, beta).
 */

/** The fake screens the panic key can throw up over the arcade. */
export const PANIC_SCREENS = [
  { id: "docs", label: "Google Docs" },
  { id: "classroom", label: "Google Classroom" },
  { id: "search", label: "Google Search" },
] as const;

export type PanicScreenId = (typeof PANIC_SCREENS)[number]["id"];

/** Whether `id` names a known panic screen (guards a stale localStorage value). */
export function isPanicScreen(id: string): id is PanicScreenId {
  return PANIC_SCREENS.some((s) => s.id === id);
}

/** Default fake screen — a blank Google Doc is the least conspicuous. */
export const DEFAULT_PANIC_SCREEN: PanicScreenId = "docs";

/**
 * Default panic hotkey. Backtick is deliberate: it sits outside WASD / arrows /
 * space, so it will not collide with the controls of a game running in the
 * player overlay. Compared against `KeyboardEvent.key`.
 */
export const DEFAULT_PANIC_KEY = "`";
