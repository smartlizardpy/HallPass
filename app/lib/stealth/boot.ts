/**
 * HallPass — the before-paint tab-cloak boot script.
 *
 * Returns a tiny self-contained JavaScript string that the root layout injects
 * with `next/script` `strategy="beforeInteractive"`, so it runs in the document
 * head during the initial parse — BEFORE the tab ever paints "HALLPASS". Without
 * it a cloaked player would see the real title/icon flash on every cold load,
 * which defeats the whole point of a disguise.
 *
 * SERVER-SAFE (no `"use client"`, no `window` at module load): it only builds a
 * string. The cloak data is serialised from {@link CLOAK_LIST}, the single source
 * of truth also used by the live controller, so the two can never disagree.
 *
 * The emitted script mirrors `applyFavicon` in `apply.ts` exactly (same primary
 * icon-link selection, same `data-hp-orig-href` stash) so that when the React
 * controller mounts a moment later it finds the DOM already in the state it would
 * itself have produced, and its first pass is a no-op.
 */

import { CLOAK_LIST } from "./cloaks";
import { STEALTH_KEY } from "./config";

export function cloakBootScript(): string {
  // Only the fields the boot script needs, keyed by id. Excludes `off` (no work).
  const map: Record<string, { title: string; favicon: string | null }> = {};
  for (const cloak of CLOAK_LIST) {
    if (cloak.id === "off") continue;
    map[cloak.id] = { title: cloak.title, favicon: cloak.favicon };
  }

  // JSON.stringify is safe to embed in an inline <script> here because the data is
  // fully controlled by us (no user input) and contains no "</script>" sequence.
  const payload = JSON.stringify({ key: STEALTH_KEY, cloaks: map });

  return `(function(){try{
var D=${payload};
var raw=localStorage.getItem(D.key);if(!raw)return;
var p=JSON.parse(raw);var id=p&&p.cloak;if(!id||id==="off")return;
var c=D.cloaks[id];if(!c)return;
if(c.title){window.__hpRealTitle=document.title;document.title=c.title;}
if(c.favicon){
var l=document.querySelector('link[rel~="icon"]:not([rel~="apple-touch-icon"])');
if(!l){l=document.createElement("link");l.setAttribute("rel","icon");document.head.appendChild(l);}
if(!l.hasAttribute("data-hp-orig-href"))l.setAttribute("data-hp-orig-href",l.getAttribute("href")||"");
l.setAttribute("type","image/svg+xml");l.setAttribute("href",c.favicon);
}
}catch(e){}})();`;
}
