"use client";

/**
 * HallPass — the appearance hatch in the sidebar footer.
 *
 * ONE BUTTON, THREE STATES, rather than a menu or a modal. It sits beside
 * `StealthMenuButton` in the rail's footer for the reason set out at length in
 * `Sidebar.tsx`: that footer is the only door on the site that every visitor can
 * reach — signed out, on a phone, in the drawer, in the collapsed rail — and a
 * theme switch behind a sign-in would be useless to most of the people who want
 * one. The Settings tab's `AppearanceCard` is the fuller control for the people
 * who have an account; this is the one everybody has.
 *
 * WHY IT CYCLES. The rail collapses to 64px, where the label is zeroed out by
 * the container (`[&_button]:text-[0px]`) and the emoji is all that is left. A
 * dropdown anchored to a 64px strip, or a modal for a single preference, is more
 * machinery than the choice deserves; pressing the button advances System →
 * Light → Dark → System, and the glyph reports where it landed.
 *
 * THE LABEL IS THE STATE, NOT THE ACTION ("Theme · Dark", not "Switch theme"),
 * because the collapsed rail keeps the text node in the accessibility tree while
 * hiding it visually — a screen reader reads this button whether or not the rail
 * is expanded, and "Dark" is the fact worth reading. `title` carries the same
 * thing for a mouse, matching the tooltips the collapsed rail gives every other
 * row.
 */

import { nextThemeChoice, THEME_OPTIONS } from "../../lib/theme/config";
import { useTheme } from "../../lib/theme/store";

export function ThemeMenuButton({ onNavigate }: { onNavigate?: () => void }) {
  const { choice, setTheme } = useTheme();
  const option = THEME_OPTIONS.find((entry) => entry.id === choice) ?? THEME_OPTIONS[0];
  const next = THEME_OPTIONS.find((entry) => entry.id === nextThemeChoice(choice));

  return (
    <button
      type="button"
      onClick={() => {
        setTheme(nextThemeChoice(choice));
        onNavigate?.();
      }}
      title={`Theme: ${option.label}${next ? ` — switch to ${next.label}` : ""}`}
      className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-extrabold text-foreground-2 transition hover:bg-brand-50 hover:text-brand"
    >
      <span aria-hidden className="text-base">
        {option.glyph}
      </span>
      Theme · {option.label}
    </button>
  );
}
