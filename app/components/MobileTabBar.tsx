"use client";

/**
 * HallPass mobile — the bottom tab bar.
 *
 * WHY A GLOBAL ISLAND, not part of `ArcadeShell`. The tabs span pages that do NOT
 * share the arcade chrome — the `/play/you` section (profile, friends, settings)
 * is its own `<main>` with no `ArcadeShell` — so the bar has to live above it.
 * Rendering it once in the root layout body (next to `<PWA/>` / `<FeaturePromo/>`)
 * makes it route-agnostic and keeps every page otherwise untouched.
 *
 * WHY IT RENDERS NOTHING ON THE SERVER AND ON DESKTOP. `useDevicePlatform()` is
 * `null` until mounted, so the bar is absent from the prerendered HTML the crawler
 * and the service-worker precache see, and it only appears on the second paint on
 * an actual phone. Desktop never gets it. Same hydration rule as the rest of the
 * mobile shell.
 *
 * BOTTOM CHROME. Because it owns the bottom edge, it publishes its measured height
 * to `--hp-bottom-chrome` so other floating elements clear it — see the effect
 * below and `app/lib/bottom-chrome.ts`.
 *
 * ADMIN. There is deliberately no admin tab. The dashboard is reachable from
 * inside the You tab (the `/play/you` section carries a role-gated Dashboard
 * link), so the bar never changes shape based on who is signed in.
 *
 * STEALTH — WHY THERE IS NO TAB ANY MORE. The phone shell drops the genre
 * hamburger, so the sidebar's "Stealth mode" entry is unreachable on a phone,
 * which once left shake-to-panic (a touch-only trigger) impossible to switch on
 * from the one class of device that can fire it. A Stealth tab was that door.
 * `/play/you/settings` now carries a stealth row, so the door still exists and
 * the case for spending a whole tab on it is gone. The need behind it has NOT
 * gone: if that settings row ever disappears, shake-to-panic goes unreachable on
 * a phone again, so give it another route rather than assuming the sidebar
 * covers it.
 */

import { useEffect, useRef } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useDevicePlatform } from "../lib/use-device-platform";
import { clearBottomChrome, publishBottomChrome } from "../lib/bottom-chrome";

/** Routes that are their own full-screen world — no player tab bar over them. */
const HIDDEN_PREFIXES = [
  "/dashboard",
  // Same reason the promo is suppressed there: `/embed/*` is a small panel
  // mounted inside a game, and site navigation has no business inside it.
  "/embed",
  "/play/signin",
  "/play/signout",
  "/play/welcome",
  "/play/auth",
];

/**
 * Is `path` this route or something nested under it? A bare `startsWith` would
 * also match a sibling that merely shares the prefix (`/play/yourthing` for
 * `/play/you`), so the separator is part of the test.
 */
function isUnder(path: string, route: string) {
  return path === route || path.startsWith(`${route}/`);
}

export function MobileTabBar() {
  const device = useDevicePlatform();
  const isMobile = device === "mobile";
  const pathname = usePathname() ?? "/";
  const barRef = useRef<HTMLElement | null>(null);

  const hidden =
    !isMobile || HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));

  // The bar covers the bottom edge of the viewport, so it owes two things to the
  // rest of the app: padding at the end of the page, so it never sits over the
  // last row of content, and a published height, so anything FLOATING above the
  // bottom edge clears it (`app/lib/bottom-chrome.ts`). Both are done from here,
  // not in global CSS, so they exist exactly when the bar does — on a phone, after
  // mount — and are removed cleanly on desktop or on a route that hides it.
  //
  // MEASURED, not the `calc(4rem + env(safe-area-inset-bottom))` constant this
  // used to hardcode. The constant lies in one real case: `lg:hidden` keeps the
  // bar off screen on a large tablet that still reports a coarse, hoverless
  // pointer, and there the component mounts while the bar renders nothing.
  // `offsetHeight` is 0 for a hidden element, so both the padding and the
  // published height correctly become "no bar here". It also picks up the bar's
  // own safe-area padding and its top border, so the number is what the bar
  // actually costs rather than what it was assumed to cost.
  useEffect(() => {
    if (hidden) return;
    const bar = barRef.current;
    if (!bar) return;

    const previousPadding = document.body.style.paddingBottom;
    const measure = () => {
      const height = bar.offsetHeight;
      publishBottomChrome(height);
      document.body.style.paddingBottom =
        height > 0 ? `${height}px` : previousPadding;
    };

    measure();
    // Crossing the `lg` breakpoint and rotating the device (which changes the
    // safe-area inset) both arrive as a resize; re-measuring is idempotent, so
    // the noisier triggers — an Android keyboard opening, say — cost nothing.
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      clearBottomChrome();
      document.body.style.paddingBottom = previousPadding;
    };
  }, [hidden]);

  if (hidden) return null;

  const homeActive = pathname === "/" || pathname.startsWith("/category");
  // Friends lives UNDER the You section, so the two tabs would both light up on
  // `/play/you/friends` if You matched the whole subtree. Friends wins its own
  // route; You covers the rest of the section (profile, settings).
  const friendsActive = isUnder(pathname, "/play/you/friends");
  const youActive = isUnder(pathname, "/play/you") && !friendsActive;

  return (
    <nav
      ref={barRef}
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-white/95 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <TabLink href="/" label="Home" active={homeActive}>
        <path d="M3 11l9-8 9 8M5 10v10h14V10" />
      </TabLink>

      {/* Two equal heads over one shared base — a symmetric "friends" mark,
          instead of the lopsided big-person/little-person users glyph. */}
      <TabLink href="/play/you/friends" label="Friends" active={friendsActive}>
        <circle cx="8" cy="8" r="3" />
        <circle cx="16" cy="8" r="3" />
        <path d="M3 20v-1a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v1" />
      </TabLink>

      <TabLink href="/play/you" label="You" active={youActive}>
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
      </TabLink>
    </nav>
  );
}

/** Shared visual shell for a tab — an icon over a label, active in brand colour. */
function TabInner({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-bold ${
        active ? "text-brand" : "text-zinc-500"
      }`}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none"
      >
        {children}
      </svg>
      {label}
    </span>
  );
}

/**
 * The tab body, rendered INSIDE the `Link` so it can read `useLinkStatus`. A tap
 * lights the tab up the instant navigation starts — `pending` counts as active —
 * so the bar feels responsive even when the destination (e.g. the dynamic You
 * page) takes a moment to arrive. The Next docs recommend exactly this pairing:
 * prefetch for speed, `useLinkStatus` for immediate feedback while it completes.
 */
function TabLinkContent({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  const { pending } = useLinkStatus();
  return (
    <TabInner label={label} active={active || pending}>
      {children}
    </TabInner>
  );
}

function TabLink({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    // Prefetch left at the default (auto): the bar is always on screen, so all
    // three routes warm up ahead of the tap, which is what makes the switch feel
    // instant in production. `prefetch={false}` here was the mistake — it forced a
    // cold round-trip on every tap.
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      style={{ touchAction: "manipulation" }}
      className="flex-1 transition active:opacity-50"
    >
      <TabLinkContent label={label} active={active}>
        {children}
      </TabLinkContent>
    </Link>
  );
}
