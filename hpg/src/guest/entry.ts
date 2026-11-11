/**
 * The bootstrap's entry point inside a game frame, bundled by esbuild into one
 * classic IIFE and injected as the first `<script>` of the game document.
 *
 * The launcher writes the configuration into the document just before this
 * script, as `window.__HPG_BOOT__`. It is read once and deleted, so the
 * game sees only the public `window.HPG` and `window.HallPass` APIs.
 */

import { installGuest, type GuestConfig } from "./install";

type BootWindow = Window & typeof globalThis & Record<string, unknown> & { __HPG_BOOT__?: GuestConfig };

const w = window as BootWindow;
const config = w.__HPG_BOOT__;
delete w.__HPG_BOOT__;
if (config) {
  // Captured now, before any game script can replace them.
  const parentWindow = w.parent;
  const post = parentWindow.postMessage.bind(parentWindow);
  installGuest(w, config, {
    // The launcher's origin is `null` (file://) or unknowable, so "*" is the only
    // possible target. Nothing secret is ever sent: saves and scores belong to
    // this game, and the receiver checks the sender itself.
    post: (m) => post(m, "*"),
    isHost: (e) => e.source === parentWindow,
  });
}
