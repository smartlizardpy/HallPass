"use client";

/**
 * HallPass — the entry point that opens the stealth settings modal.
 *
 * Deliberately dumb: it just fires the `OPEN_STEALTH_EVENT` the controller
 * listens for, so the same button can be dropped into the desktop sidebar, the
 * mobile drawer, or anywhere else without wiring modal state through the tree.
 */

import { openStealthSettings } from "../../lib/stealth/store";

export function StealthMenuButton({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        openStealthSettings();
        onNavigate?.();
      }}
      className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-extrabold text-zinc-700 transition hover:bg-brand-50 hover:text-brand"
    >
      <span aria-hidden className="text-base">🕶️</span>
      Stealth mode
    </button>
  );
}
