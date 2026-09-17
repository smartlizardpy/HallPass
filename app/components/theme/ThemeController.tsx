"use client";

/**
 * HallPass — the theme CONTROLLER, mounted once in the root layout.
 *
 * Renders nothing. It owns the two things the before-paint boot script
 * deliberately does not:
 *
 *  1. FOLLOWING THE DEVICE WHILE THE TAB IS OPEN. A `matchMedia` listener
 *     republishes the OS preference into the store, so a Chromebook that flips
 *     to dark at sunset repaints the arcade under a player sitting on `System`
 *     without a reload. A listener needs cleaning up, which is why it lives in a
 *     component rather than at module scope.
 *
 *  2. PUBLISHING THE RESOLVED THEME. One effect, and the only writer of
 *     `data-theme` after the boot script — the setters in the store touch no DOM
 *     — so there is no path where a click and an effect can disagree about what
 *     the page is painted in. On a normal load it writes the value the boot
 *     script already wrote, i.e. does nothing visible; it earns its keep when
 *     the attribute is missing (the script was blocked, or the browser threw)
 *     and when the choice or the device changes later.
 *
 * It reads no session and renders no markup, so the pages that mount it stay
 * statically prerenderable and thus precacheable by the service worker — the
 * same contract as `StealthController`, `WelcomeToast` and `PWA`.
 */

import { useEffect } from "react";
import { DARK_QUERY, THEME_ATTR } from "../../lib/theme/config";
import { readSystemTheme, setSystemTheme, useTheme } from "../../lib/theme/store";

export function ThemeController() {
  const { resolved } = useTheme();

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(DARK_QUERY);
    // Seeded again here, not only in the store's first read: the preference can
    // change while the tab is bfcached or while this module is being loaded, and
    // the listener below only reports CHANGES from now on.
    setSystemTheme(readSystemTheme());
    const onChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute(THEME_ATTR, resolved);
  }, [resolved]);

  return null;
}
