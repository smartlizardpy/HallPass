"use client";

/**
 * HallPass — what device the visitor is actually holding, decided in the BROWSER.
 *
 * WHY NOT ON THE SERVER. The obvious implementation reads the `User-Agent` header
 * during the render and returns a device-specific catalogue. That would be wrong
 * here in a way that does not show up until production: the moment the HTML
 * depends on the request, it stops being one cacheable payload. This site is
 * prerendered, served through a CDN, reads its overrides through
 * `unstable_cache`, AND precaches pages in a cache-first service worker
 * (`public/sw.js`). The failure mode is not an error — it is a desktop-rendered
 * page cached and handed to a phone (or the reverse), then pinned there by the
 * service worker across reloads.
 *
 * Deciding in the browser sidesteps all of it. Every visitor and every crawler
 * gets byte-identical HTML; the device-specific part happens after hydration.
 *
 * WHY NOT SNIFF THE USER-AGENT AT ALL. iPads have reported a desktop UA for years,
 * every vendor lies in the string eventually, and the question we actually care
 * about is "can this person use a keyboard", which the UA does not answer.
 * `(pointer: coarse)` asks the browser directly.
 */

import { useEffect, useState } from "react";
import type { Game } from "./games";

/**
 * What the VISITOR is on. Note this is two-valued while {@link Game.platform} is
 * three-valued: a device is one or the other, a game may support both.
 */
export type DevicePlatform = "desktop" | "mobile";

/**
 * Coarse pointer AND a small viewport. Both halves are load-bearing:
 *
 *   - `(pointer: coarse)` alone matches a touchscreen laptop, which is a keyboard
 *     machine and should get the desktop treatment.
 *   - a width bound alone matches a narrow window on a desktop, which is also a
 *     keyboard machine.
 *
 * Together they are a decent proxy for "phone". Not a perfect one — which is
 * exactly why nothing downstream ever HIDES a game based on this, it only sorts
 * and labels, and the play warning is a confirm the visitor can walk straight
 * through.
 */
const MOBILE_QUERY = "(pointer: coarse) and (max-width: 900px)";

/**
 * The visitor's device, or `null` before the first effect runs.
 *
 * THE `null` IS THE IMPORTANT PART, not a loading-state nicety. The server render
 * and the first client render must produce identical markup or React reports a
 * hydration mismatch — and `Arcade` is prerendered and sits in the service-worker
 * precache, so the shared HTML has to be device-neutral. `null` means "not known
 * yet, render exactly what the prerender contains"; the device-aware pass happens
 * on the render after mount. The extra render is the POINT, not an oversight —
 * the same reasoning is spelled out for the `?q=` seeding in `Arcade.tsx`.
 *
 * Re-evaluates on change, so rotating a tablet or dragging a desktop window
 * narrow updates the UI rather than stranding it on the first answer.
 */
export function useDevicePlatform(): DevicePlatform | null {
  const [device, setDevice] = useState<DevicePlatform | null>(null);

  useEffect(() => {
    // `matchMedia` is guarded for very old browsers and for any environment that
    // renders this without a full DOM; a missing implementation simply leaves the
    // device unknown, which is the neutral rendering.
    const mq = window.matchMedia?.(MOBILE_QUERY);
    if (!mq) return;
    const apply = () => setDevice(mq.matches ? "mobile" : "desktop");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return device;
}

/**
 * Can `game` be played on `device`? THREE-VALUED on purpose:
 *
 *   - `true`  — tagged, and it runs here
 *   - `false` — tagged, and it does not
 *   - `null`  — UNKNOWN; the game has never been checked
 *
 * The `null` is what keeps an untagged catalogue looking untouched. Collapsing it
 * into `false` would badge and demote every game nobody has got round to testing;
 * collapsing it into `true` would silently promise touch support for all of them.
 * Callers must handle all three — which in practice means "render nothing".
 *
 * Pure and DOM-free so it can be unit tested; the hook above supplies `device`.
 */
export function playsOn(game: Game, device: DevicePlatform): boolean | null {
  if (!game.platform) return null;
  return game.platform === "both" || game.platform === device;
}
