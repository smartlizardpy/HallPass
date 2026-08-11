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

/** One tab. Order here is the order on screen. */
const TABS = [
  { href: "/play/you", label: "Profile" },
  { href: "/play/you/friends", label: "Friends" },
  { href: "/play/you/settings", label: "Settings" },
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
            className={`flex-1 rounded-full px-4 py-2 text-center text-sm font-extrabold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 ${
              current
                ? "bg-brand text-white"
                : "text-zinc-700 hover:bg-surface-2 hover:text-zinc-900"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
