/**
 * Fright Fest 2026 — the CHAMPIONSHIP flag. Independent of the theme.
 *
 * This module imports nothing from the theme files and the theme files import
 * nothing from here (a test enforces both directions). It exists only to give
 * the competition its own switch; the competition itself is not built yet, so
 * every surface that mentions it shows an honest "upcoming" state while this is
 * `false`. Turning it on never changes how the site looks, and turning the theme
 * off never touches competition data.
 */

export const FRIGHT_FEST_CHAMPIONSHIP = {
  id: "fright-fest-2026-championship",
  enabled: false,
} as const;

export function championshipEnabled(): boolean {
  return FRIGHT_FEST_CHAMPIONSHIP.enabled;
}
