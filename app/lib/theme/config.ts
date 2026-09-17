/**
 * HallPass — appearance (light/dark) configuration. Pure data, no `window`.
 *
 * Kept separate from {@link file://./store.ts} so the choice list, the storage
 * key and the resolver can be imported by the SERVER-rendered boot script and by
 * unit tests without dragging in the `"use client"` store. Same split, and the
 * same reason, as `lib/stealth/config.ts`.
 *
 * THE ONE DISTINCTION THIS FILE EXISTS TO KEEP STRAIGHT: a CHOICE is what the
 * player picked and is one of three (`system` / `light` / `dark`); a RESOLVED
 * theme is what the page is actually painted in and is one of two. Only the
 * resolved value ever reaches the DOM, so nothing downstream — CSS included —
 * has to know what "system" meant on this device at this moment.
 */

/**
 * localStorage key holding the appearance CHOICE, as a bare string (`"dark"`),
 * not JSON. It is a single scalar with three legal values; wrapping it in an
 * object would buy a migration story for a payload that cannot grow.
 *
 * Lives here, not in the store, so the boot script and the client store share
 * ONE literal — a drift between them would paint the page from a key nobody
 * writes.
 */
export const THEME_KEY = "hp:theme";

/**
 * The attribute the resolved theme is published on, always on `<html>`.
 * `globals.css` selects on it (`:root[data-theme="dark"]`) and the `dark:`
 * variant is defined in terms of it.
 */
export const THEME_ATTR = "data-theme";

/** What the player picked. */
export type ThemeChoice = "system" | "light" | "dark";

/** What the page is painted in. Never `"system"`. */
export type ResolvedTheme = "light" | "dark";

/**
 * The three choices, in the order every control offers them.
 *
 * `glyph` is the button face in the sidebar rail, where the label can be
 * collapsed to nothing (see `Sidebar.tsx`), so the emoji is sometimes the only
 * thing on screen: each has to read as its own mode at 16px. `hint` is the
 * one-line description under the label in the Settings card.
 */
export const THEME_OPTIONS = [
  {
    id: "system",
    label: "System",
    hint: "Match whatever this device is set to.",
    glyph: "🖥️",
  },
  {
    id: "light",
    label: "Light",
    hint: "Always light, whatever the device says.",
    glyph: "☀️",
  },
  {
    id: "dark",
    label: "Dark",
    hint: "Always dark, whatever the device says.",
    glyph: "🌙",
  },
] as const satisfies readonly { id: ThemeChoice; label: string; hint: string; glyph: string }[];

export type ThemeOption = (typeof THEME_OPTIONS)[number];

/**
 * The out-of-the-box choice. System, deliberately: a player who never opens the
 * control gets the theme their Chromebook already asked for, and the site has an
 * opinion about appearance only once someone states one.
 */
export const DEFAULT_THEME: ThemeChoice = "system";

/** Whether `value` names a known choice (guards a stale localStorage value). */
export function isThemeChoice(value: string): value is ThemeChoice {
  return THEME_OPTIONS.some((option) => option.id === value);
}

/**
 * Tolerantly read a stored choice. Anything missing, unknown or written by an
 * older build falls back to {@link DEFAULT_THEME} rather than leaving the page
 * with no theme at all. Never throws.
 */
export function parseThemeChoice(raw: string | null | undefined): ThemeChoice {
  if (typeof raw !== "string" || !isThemeChoice(raw)) return DEFAULT_THEME;
  return raw;
}

/**
 * Collapse a choice and the device's current preference into the one value that
 * gets painted. `system` defers; `light` and `dark` deliberately do not, which
 * is the whole point of offering them — an explicit choice has to survive a
 * device that disagrees.
 */
export function resolveTheme(
  choice: ThemeChoice,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (choice === "system") return systemPrefersDark ? "dark" : "light";
  return choice;
}

/**
 * The next choice in {@link THEME_OPTIONS} order, wrapping at the end — what the
 * one-button control in the sidebar advances to on each press. An unrecognised
 * current value restarts the cycle rather than dead-ending it.
 */
export function nextThemeChoice(choice: ThemeChoice): ThemeChoice {
  const index = THEME_OPTIONS.findIndex((option) => option.id === choice);
  return THEME_OPTIONS[(index + 1) % THEME_OPTIONS.length].id;
}

/** The media query the resolver's `systemPrefersDark` argument comes from. */
export const DARK_QUERY = "(prefers-color-scheme: dark)";
