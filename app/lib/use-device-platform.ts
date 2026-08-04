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

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Game } from "./games";

/**
 * What the VISITOR is on. Note this is two-valued while {@link Game.platform} is
 * three-valued: a device is one or the other, a game may support both.
 */
export type DevicePlatform = "desktop" | "mobile";

/**
 * Coarse PRIMARY pointer AND no hover. Both halves are load-bearing:
 *
 *   - `(pointer: coarse)` alone matches a touchscreen laptop, which is a keyboard
 *     machine and should get the desktop treatment.
 *   - `(hover: none)` is what separates a real touch device from that laptop: a
 *     laptop's primary input can hover (trackpad/mouse), a phone's cannot.
 *
 * WHY NOT A `max-width` BOUND, which is the obvious way to do this. A pixel width
 * is not a device fact, it is a viewport fact, and it gets the answer wrong on the
 * exact devices this feature is for. A large iPhone in LANDSCAPE is 926–932 CSS px
 * wide (14/15/16 Pro Max and Plus) — past any "phone-sized" cutoff around 900 —
 * so the moment someone rotates their phone to actually play, a width test flips
 * them to "desktop" and every badge, sort and warning silently switches off. That
 * regression is invisible in portrait and in the simulator's default size, which
 * is exactly how it survives review. `(hover: none)` asks the real question —
 * "can this input hover" — and answers it the same in both orientations and on
 * every screen size.
 *
 * Together they are a decent proxy for "phone". Not a perfect one — which is
 * exactly why nothing downstream ever HIDES a game based on this, it only sorts
 * and labels, and the play warning is a confirm the visitor can walk straight
 * through.
 */
const MOBILE_QUERY = "(pointer: coarse) and (hover: none)";

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
export function useRawDevice(): DevicePlatform | null {
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
 * The "force desktop" preference — a phone visitor's explicit "show me the full
 * desktop site anyway" choice, the escape hatch behind the mobile shell.
 *
 * Persisted in localStorage so it STICKS across reloads (a per-session store would
 * bounce them back to the mobile shell on the next visit), and exposed through
 * `useSyncExternalStore` so flipping it re-renders every consumer of
 * {@link useDevicePlatform} at once — the whole shell (catalogue, header, tab bar,
 * splash) turns over from one setter.
 *
 * The SERVER snapshot is always `false`: the first client render must match the
 * override-free prerendered HTML, and the real value is read on the render AFTER
 * hydration — the same second-paint rule the raw device hook follows, so there is
 * no hydration mismatch.
 */
const FORCE_DESKTOP_KEY = "hp-force-desktop";
const forceListeners = new Set<() => void>();

function forceSubscribe(onChange: () => void): () => void {
  forceListeners.add(onChange);
  window.addEventListener("storage", onChange); // keep tabs in sync
  return () => {
    forceListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getForceSnapshot(): boolean {
  try {
    return localStorage.getItem(FORCE_DESKTOP_KEY) === "1";
  } catch {
    return false;
  }
}

/** Set or clear the force-desktop preference, then notify every subscriber. */
export function setForceDesktop(on: boolean): void {
  try {
    if (on) localStorage.setItem(FORCE_DESKTOP_KEY, "1");
    else localStorage.removeItem(FORCE_DESKTOP_KEY);
  } catch {
    // Private mode / storage disabled: the toggle simply won't persist.
  }
  forceListeners.forEach((l) => l());
}

/** Whether the visitor has asked to see the desktop site on their phone. */
export function useForceDesktop(): boolean {
  return useSyncExternalStore(forceSubscribe, getForceSnapshot, () => false);
}

/**
 * The EFFECTIVE device — the raw detection, unless the visitor has explicitly
 * forced the desktop site. Every consumer reads THIS (not {@link useRawDevice}),
 * so the one preference flips the entire shell. The switch control itself reads
 * `useRawDevice` + `useForceDesktop` directly, because it must stay visible to a
 * phone that is currently being shown desktop.
 */
export function useDevicePlatform(): DevicePlatform | null {
  const raw = useRawDevice();
  const forceDesktop = useForceDesktop();
  return forceDesktop ? "desktop" : raw;
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

/**
 * The games the MOBILE shell lists — the curated touch arcade.
 *
 * STRICT on purpose: only games a human has confirmed play on a phone (`mobile`
 * or `both`). Untagged games are EXCLUDED here even though `playsOn` treats them
 * as unknown-not-unplayable — the mobile shell is a promise ("everything here
 * works under your thumb"), and padding it with unchecked games is exactly the
 * "tapped a WASD runner, it didn't respond, left" failure the platform tag exists
 * to prevent. The list is short until more games are tagged; that is the honest
 * state, not a bug. Order is preserved from the input so the existing ranking
 * survives.
 *
 * Pure and DOM-free, like {@link playsOn}, so it is unit-tested directly.
 */
export function mobileCatalog(games: Game[]): Game[] {
  return games.filter((g) => playsOn(g, "mobile") === true);
}
