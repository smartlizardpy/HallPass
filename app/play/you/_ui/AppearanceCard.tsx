"use client";

/**
 * The Settings-tab card that chooses light, dark, or whatever the device says.
 *
 * The full control, next to `StealthSettingsRow`'s compact one: this page has
 * the room for three labelled options with their consequences spelled out, where
 * the sidebar hatch has 64px and has to cycle. Both write the same key, live, so
 * a change here moves the rail's glyph and vice versa.
 *
 * A RADIOGROUP, NOT THREE BUTTONS OR A SWITCH. The options are exclusive and one
 * of them is always in effect, which is a radio group's exact contract — so
 * arrow keys move between them, the group is announced with the chosen option,
 * and no ARIA has to be invented. A two-state switch could not express "System"
 * at all, and System is the default.
 *
 * WHY THE BUTTONS DO NOT PREVIEW THEIR OWN THEME. A dark swatch on a light page
 * is a picture of the theme, which goes stale the moment the palette changes.
 * Pressing an option repaints the ENTIRE page instantly — the preference applies
 * before the click's re-render is even visible — so the real preview is the site
 * itself, and the card only has to say which one is on.
 *
 * NOT rendered in `NotSignedInCard` the way the stealth row is. The sidebar
 * footer already carries a signed-out, phone-reachable theme switch (it is why
 * `ThemeMenuButton` lives there), so the gap that forced the stealth row to
 * appear twice does not exist here.
 */

import { THEME_OPTIONS } from "@/app/lib/theme/config";
import { useTheme } from "@/app/lib/theme/store";

export function AppearanceCard() {
  const { choice, setTheme } = useTheme();

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h3
        id="settings-appearance"
        className="text-sm font-black uppercase tracking-wide text-foreground"
      >
        <span aria-hidden className="mr-1.5">
          🌓
        </span>
        Appearance
      </h3>
      <p className="mt-2 text-sm text-muted">
        Saved on this device, like your stealth settings — not to your account.
      </p>

      <div
        role="radiogroup"
        aria-labelledby="settings-appearance"
        className="mt-4 grid gap-2 sm:grid-cols-3"
      >
        {THEME_OPTIONS.map((option) => {
          const active = option.id === choice;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(option.id)}
              className={`rounded-xl border p-4 text-left transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 ${
                active
                  ? "border-brand bg-brand-50"
                  : "border-border bg-surface-2 hover:border-brand"
              }`}
            >
              <div
                className={`text-sm font-black ${active ? "text-brand" : "text-foreground"}`}
              >
                <span aria-hidden className="mr-1.5">
                  {option.glyph}
                </span>
                {option.label}
              </div>
              <p className="mt-1 text-xs font-semibold text-muted">{option.hint}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
