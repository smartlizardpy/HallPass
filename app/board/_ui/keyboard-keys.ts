/**
 * Key layout and editing rules for the on-screen keyboard panel, pure so they are
 * unit-tested. The panel edits ONLY the username (or the library search) — never
 * the PIN, which has its own pad and is never held in a text value.
 *
 * Username charset is `[a-z0-9_]`, 3–20 characters (`app/lib/username.ts`), and
 * the server lower-cases input, so the layout has no shift key: every character a
 * username can contain is on it, and nothing else is.
 */

import { USERNAME_MAX_LENGTH } from "@/app/lib/username";

export type KeyboardMode = "username" | "search";

export const SEARCH_MAX_LENGTH = 40;

export const BACKSPACE = "Backspace";
export const CLEAR = "Clear";

const ROWS: readonly (readonly string[])[] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "_"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

/** Search additionally allows a hyphen and a space. */
export function rowsFor(mode: KeyboardMode): readonly (readonly string[])[] {
  if (mode === "username") return ROWS;
  return [...ROWS.slice(0, 3), [...ROWS[3], "-"]];
}

export function maxLength(mode: KeyboardMode): number {
  return mode === "username" ? USERNAME_MAX_LENGTH : SEARCH_MAX_LENGTH;
}

export function isAllowed(ch: string, mode: KeyboardMode): boolean {
  if (ch.length !== 1) return false;
  if (/^[a-z0-9_]$/.test(ch)) return true;
  return mode === "search" && (ch === "-" || ch === " ");
}

/**
 * Apply one key press. Unknown keys and presses over the length cap leave the
 * value untouched, so a stuck or odd key can never produce an invalid username.
 */
export function applyKey(value: string, key: string, mode: KeyboardMode): string {
  if (key === BACKSPACE) return value.slice(0, -1);
  if (key === CLEAR) return "";
  if (!isAllowed(key, mode)) return value;
  if (value.length >= maxLength(mode)) return value;
  return value + key;
}
