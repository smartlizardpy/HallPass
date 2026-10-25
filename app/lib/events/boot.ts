/**
 * HallPass — the before-paint event boot script.
 *
 * Same shape and reasons as `lib/theme/boot.ts`: a tiny inline script injected
 * `beforeInteractive`, run straight AFTER the theme boot script so it can
 * override `data-theme` before first paint. The server never reads the clock, so
 * the prerendered HTML is identical for everyone and a precached copy opened
 * months later still decides from the real time. Fails closed: any error, or no
 * JavaScript, leaves the attributes unset and the normal site.
 *
 * It mirrors `resolveEvent` in `look.ts` (a test runs both over a table). It
 * never writes localStorage.
 */

import { THEME_ATTR, THEME_KEY } from "../theme/config";
import { EVENT_ATTR, EVENT_PHASE_ATTR, SKIN_ATTR } from "./config";
import type { ThemeWindow } from "./types";

export function eventBootScript(theme: ThemeWindow): string {
  const start = Date.parse(theme.startAt);
  const end = Date.parse(theme.endAt);
  // A disabled or malformed window ships a script that does nothing.
  if (!theme.enabled || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return "";
  }
  const j = JSON.stringify;
  return `(function(){try{
var n=Date.now();if(n<${start}||n>=${end})return;
var p=location.pathname,x=${j(theme.excludedPaths)};
for(var i=0;i<x.length;i++){if(p===x[i]||p.indexOf(x[i]+"/")===0)return;}
var l=localStorage.getItem(${j(theme.lookKey)});
var h=document.documentElement;
h.setAttribute(${j(EVENT_ATTR)},${j(theme.event)});
h.setAttribute(${j(EVENT_PHASE_ATTR)},"live");
if(l==="normal")return;
if(l!=="dark"&&l!=="light")l=localStorage.getItem(${j(THEME_KEY)})==="light"?"light":"dark";
h.setAttribute(${j(SKIN_ATTR)},${j(theme.skin)});
h.setAttribute(${j(THEME_ATTR)},l);
}catch(e){}})();`;
}
