"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The tab strip for `/play/you`.
 *
 * A CLIENT COMPONENT for one reason: the active tab depends on the pathname,
 * and a layout cannot read it. Layouts do not re-render on navigation — they are
 * cached and reused — so a pathname read there would be stale the moment you
 * changed tabs, which is exactly the case the Next docs call out
 * (`03-file-conventions/layout.md`, "Pathname"). `usePathname` in a client
 * component re-renders on every navigation, so it is always right.
 *
 * REAL LINKS, NOT BUTTONS. Each tab is a distinct URL, so each is an `<a>`:
 * deep-linkable, shareable, restorable by the back button, and working with no
 * JavaScript at all. That is also why this is NOT `role="tablist"` — ARIA tabs
 * describe panels swapped in place within one document, and announcing these as
 * tabs would promise a screen-reader user that activating one keeps them on the
 * page. They are navigation, so they are a `<nav>`, and the current one is
 * marked with `aria-current="page"`.
 */

/**
 * One tab. Order here is the order on screen.
 *
 * `short` IS NOT OPTIONAL POLISH — it is what lets a fourth tab exist at all.
 * The strip divides its width equally (`flex-1`), so on a 390px phone each tab
 * gets about 80px inside the layout's `px-6` and this strip's own padding, of
 * which the label may use ~64. "Notifications" needs more than double that: it
 * would either wrap to two lines or force the strip to overflow. Every entry
 * carries one so the rule is uniform rather than a special case bolted onto the
 * one long word, and the full label comes back at `sm`, where there is room.
 *
 * This is the same collapse `SiteHeader` already does to "What's New" in the
 * band where the tabs and the rail are both on screen: shorten the label where
 * the row cannot pay for it, never drop the control.
 */
const TABS = [
  { href: "/play/you", label: "Profile", short: "Profile" },
  { href: "/play/you/friends", label: "Friends", short: "Friends" },
  { href: "/play/you/notifications", label: "Notifications", short: "Alerts" },
  { href: "/play/you/settings", label: "Settings", short: "Settings" },
] as const;

/**
 * Which tab the current pathname belongs to.
 *
 * LONGEST MATCH WINS, rather than a per-tab "exact?" flag. `/play/you` is a
 * prefix of both of its siblings, so a naive `startsWith` would light up Profile
 * on every tab; picking the longest matching href gets that right without the
 * tab list having to carry a flag that a fourth tab could forget to set.
 *
 * The trailing slash is stripped first because `next.config.ts` sets
 * `skipTrailingSlashRedirect` (load-bearing for bundled games' relative asset
 * URLs), so `/play/you/settings/` is SERVED rather than redirected and would
 * otherwise match nothing at all.
 */
function activeHref(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  let best: string | null = null;
  for (const tab of TABS) {
    const matches = path === tab.href || path.startsWith(`${tab.href}/`);
    if (matches && (best === null || tab.href.length > best.length)) {
      best = tab.href;
    }
  }
  return best;
}

export function YouTabs() {
  const active = activeHref(usePathname());

  return (
    <nav
      aria-label="Your profile sections"
      className="flex gap-1 rounded-full border border-border bg-surface p-1"
    >
      {TABS.map((tab) => {
        const current = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            // `px-2` below `sm` and `whitespace-nowrap` throughout: with four
            // tabs the horizontal padding is the difference between a label that
            // fits and one that wraps to a second line, and a wrapped tab would
            // make the whole strip two rows tall.
            className={`flex-1 whitespace-nowrap rounded-full px-2 py-2 text-center text-sm font-extrabold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 sm:px-4 ${
              current
                ? "bg-brand text-white"
                : "text-zinc-700 hover:bg-surface-2 hover:text-zinc-900"
            }`}
          >
            {/* Both rendered, one shown — rather than picking in JS off a
                viewport measurement, which this component has no way to read
                during a prerender and would hydrate wrong. */}
            <span className="sm:hidden">{tab.short}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
