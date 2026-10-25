"use client";

/**
 * HallPass — the event CONTROLLER, mounted once in the root layout.
 *
 * Renders nothing. The boot script paints the skin before first paint; this
 * keeps it right afterwards, for the three things the script cannot see:
 *
 *  - SOFT NAVIGATION: the App Router does not reload, so a trip from the arcade
 *    to /dashboard has to drop the skin and the trip back has to restore it.
 *  - A CHANGED CHOICE: the event look menu or the permanent theme (which the
 *    event reads, never writes) changed in this tab or another.
 *  - EXPIRY IN A LONG-LIVED TAB: it re-checks the clock when the tab regains
 *    focus and at the end time, so a tab left open across 1 Nov goes back.
 *
 * It is the ONLY writer of the event attributes and, while the skin is on, of
 * `data-theme`. `ThemeController` stands down whenever `data-hp-skin` is set, so
 * the two never fight. When the skin is off this hands `data-theme` straight back
 * by dispatching nothing: `ThemeController` repaints on its next effect, and this
 * restores the resolved permanent theme itself so there is no gap.
 *
 * Nothing here knows the championship exists.
 */

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { EVENT_ATTR, EVENT_PHASE_ATTR, SKIN_ATTR } from "../../lib/events/config";
import { FRIGHT_FEST_THEME as T } from "../../lib/events/fright-fest";
import { useEventLook } from "../../lib/events/look-store";
import { resolveEvent } from "../../lib/events/look";
import { THEME_ATTR } from "../../lib/theme/config";
import { useTheme } from "../../lib/theme/store";

export function EventController() {
  const pathname = usePathname();
  const { look } = useEventLook();
  const { choice, resolved } = useTheme();
  // The stores answer with a neutral server snapshot during hydration. Acting on
  // it would briefly repaint a Light player in Haunted Dark, so wait one commit
  // for the real values; the boot script has covered first paint until then.
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!ready) return;
    const html = document.documentElement;

    const apply = () => {
      const r = resolveEvent(T, {
        nowMs: Date.now(),
        path: pathname,
        eventLook: look,
        savedTheme: choice,
      });
      if (r.on) {
        html.setAttribute(EVENT_ATTR, T.event);
        html.setAttribute(EVENT_PHASE_ATTR, "live");
        html.setAttribute(SKIN_ATTR, T.skin);
        html.setAttribute(THEME_ATTR, r.theme);
      } else {
        const wasOn = html.hasAttribute(SKIN_ATTR);
        html.removeAttribute(EVENT_ATTR);
        html.removeAttribute(EVENT_PHASE_ATTR);
        html.removeAttribute(SKIN_ATTR);
        if (wasOn) html.setAttribute(THEME_ATTR, resolved);
      }
    };

    apply();
    const onVisible = () => {
      if (document.visibilityState === "visible") apply();
    };
    document.addEventListener("visibilitychange", onVisible);

    // Fire once at the end of the window for a tab that stays visible.
    const end = Date.parse(T.endAt);
    const wait = end - Date.now();
    // setTimeout caps near 24.8 days; a longer wait is re-armed by the visibility path.
    const timer =
      T.enabled && wait > 0 && wait < 2_000_000_000 ? window.setTimeout(apply, wait + 50) : undefined;

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) window.clearTimeout(timer);
    };
  }, [ready, pathname, look, choice, resolved]);

  return null;
}
