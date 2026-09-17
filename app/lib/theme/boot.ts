/**
 * HallPass — the before-paint theme boot script.
 *
 * Returns a tiny self-contained JavaScript string that the root layout injects
 * with `next/script` `strategy="beforeInteractive"`, so it runs in the document
 * head during the initial parse — BEFORE the page paints. Without it, a player
 * who chose Dark would get a full white flash on every cold load while React
 * booted, which is the one bug a theme switcher is judged on.
 *
 * SERVER-SAFE (no `"use client"`, no `window` at module load): it only builds a
 * string, from the same constants the client store uses, so the key it reads and
 * the attribute it writes can never drift from the ones everything else assumes.
 * Exactly the shape of `lib/stealth/boot.ts`, which does this for the tab cloak.
 *
 * WHAT IT DOES *NOT* DO, on purpose:
 *
 *  - It never writes localStorage. A visitor who has expressed no preference
 *    leaves no trace; the attribute it sets is a rendering of the OS state, not
 *    a decision recorded on their behalf.
 *  - It does not listen for anything. Following the OS *while the tab is open*
 *    belongs to `ThemeController`, which can clean its listener up.
 *
 * If it throws (a locked-down `localStorage`, a browser with no `matchMedia`),
 * it fails silently and leaves the attribute UNSET — which is precisely the
 * state `globals.css` covers with `@media (prefers-color-scheme: dark)`, so the
 * page still lands on the right theme by CSS alone.
 */

import { DARK_QUERY, THEME_ATTR, THEME_KEY } from "./config";

export function themeBootScript(): string {
  // Our own constants, never user input — JSON.stringify is enough to embed them
  // safely in an inline <script> (no "</script>" sequence is possible).
  const key = JSON.stringify(THEME_KEY);
  const attr = JSON.stringify(THEME_ATTR);
  const query = JSON.stringify(DARK_QUERY);

  // Mirrors `resolveTheme` in `config.ts`: an unrecognised stored value (absent,
  // corrupt, or "system") falls through to the device preference, and only an
  // explicit "light"/"dark" short-circuits it.
  return `(function(){try{
var c=localStorage.getItem(${key});
var d=c==="dark"||(c!=="light"&&!!window.matchMedia&&window.matchMedia(${query}).matches);
document.documentElement.setAttribute(${attr},d?"dark":"light");
}catch(e){}})();`;
}
