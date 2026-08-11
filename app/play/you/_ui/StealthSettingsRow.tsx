"use client";

/**
 * The Settings-tab row that opens the stealth settings modal.
 *
 * Deliberately dumb, and deliberately a copy of `StealthMenuButton` rather than
 * a reuse of it: the modal lives once inside `StealthController` (mounted in the
 * root layout), and any launcher anywhere in the tree just fires
 * `OPEN_STEALTH_EVENT` for it to hear. A `CustomEvent` name is the smallest
 * possible coupling between the two, and it is why this component needs no props
 * and holds no state.
 *
 * WHY NOT LITERALLY REUSE `StealthMenuButton`. That component is styled as a
 * compact menu row for the desktop sidebar and the mobile drawer — small, flush,
 * hover-tinted. Dropped into this page it would be the only control that did not
 * look like the cards around it. The behaviour is a two-line function call; the
 * styling is the part that differs, so this borrows the pattern and not the
 * markup. If a third launcher ever appears it is worth extracting the button
 * shape; two is not enough to know what the shared shape should be.
 *
 * WHY IT LIVES HERE AT ALL. The mobile tab bar lost its Stealth tab, and the bar
 * is for things every visitor uses. Stealth settings are a preference, and
 * preferences belong on the settings tab — which is where a player already is
 * when they go looking for "things that are mine".
 *
 * RENDERED TWICE, ON PURPOSE. The Settings tab is only half the story: it sits
 * behind the subtree's `auth()` check, and on a phone there is no hamburger, no
 * drawer and no Stealth tab, so a signed-out player would have had no route to
 * the modal at all. `NotSignedInCard` therefore renders this too — see its
 * docblock for the full trace. Nothing here needs an account: the preferences
 * are per-device `localStorage`, so the modal behaves identically either side of
 * the gate.
 */

import { openStealthSettings } from "@/app/lib/stealth/store";

export function StealthSettingsRow() {
  return (
    <button
      type="button"
      onClick={() => openStealthSettings()}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface p-6 text-left transition hover:border-brand focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
    >
      <div className="min-w-0">
        <div className="text-sm font-black uppercase tracking-wide text-foreground">
          <span aria-hidden className="mr-1.5">
            🕶️
          </span>
          Stealth mode
        </div>
        <p className="mt-1 text-xs font-semibold text-muted">
          Disguise the tab, pick a panic key, and quieten notifications.
        </p>
      </div>
      <span aria-hidden className="shrink-0 text-xl font-black text-brand">
        →
      </span>
    </button>
  );
}
