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
 * WHERE THE TABS COME FROM. The destinations, their order and — the part that
 * matters — the rule each one uses to decide it is current all come from
 * `PRIMARY_NAV` in `./primary-nav`, the same table the desktop rail and the top
 * bar read. This bar is where those three destinations were first designed (see
 * that table's docblock, which calls the rail "the desktop answer to that bar"),
 * and it carried its own hand-written copy of the matching rules until the table
 * existed. Two copies of the You/Friends carve-out below is exactly the drift the
 * table was extracted to prevent, so there is now one copy, here as everywhere.
 *
 * WHAT STAYS LOCAL, AND WHY. A phone tab is a glyph with a word under it, so this
 * surface cares about the presentation the other two can shrug off:
 *
 *   1. THE ICONS ARE DRAWN, NOT WRAPPED. `PRIMARY_NAV`'s fragments are stroke-only
 *      line art on a 24-unit viewBox, which is this bar's grid as much as
 *      `NavIcon`'s — so the fragments come straight from the table, but into the
 *      local `<svg>` in `TabInner`, at 24x24 rather than `NavIcon`'s 20x20. A tab
 *      icon has to carry a row on its own at thumb distance; the rail's glyph sits
 *      next to a label in a scan-column. Do not import `NavIcon` here to "share
 *      one more thing" — that would silently shrink every tab.
 *   2. `PHONE_FACE` OVERRIDES THE FACE, NEVER THE DESTINATION. Where the phone
 *      names or draws a shared destination differently, it says so there and
 *      nowhere else. It is deliberately not a second tab list: `href`, `match` and
 *      the order are the table's, and an entry with no override wears the table's
 *      label and glyph.
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
import { PRIMARY_NAV, normalizePath } from "./primary-nav";

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
 * What the phone calls a shared destination, and what it draws for it — keyed by
 * the `PRIMARY_NAV` href it overrides. Presentation ONLY: nothing in here can add,
 * remove, reorder or re-point a tab, so this bar and the desktop surfaces cannot
 * end up disagreeing about where a tab goes or when it is lit.
 *
 * Only `/` needs an entry. Friends and You wear the table's own label and glyph,
 * because those two marks were drawn for this bar in the first place and
 * `PRIMARY_NAV` adopted them verbatim (its icon comments say so) — sharing them is
 * how they stay one mark instead of two that drift.
 *
 * `/` is the exception on both counts. On desktop that destination is "Games", one
 * of several places the rail can take you. Here it is the way back out of every
 * other tab, which is what a phone tab bar's first slot means, so it is "Home"
 * under a house — the word and the glyph a thumb expects at the bottom-left of a
 * phone. It is deliberately NOT the table's gamepad, which reads as "the games
 * section" rather than "back to the start".
 */
const PHONE_FACE: Record<string, { label?: string; icon?: React.ReactNode }> = {
  "/": {
    label: "Home",
    icon: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
  },
};

export function MobileTabBar() {
  const device = useDevicePlatform();
  const isMobile = device === "mobile";
  // Normalised, because `next.config.ts` sets `skipTrailingSlashRedirect: true`:
  // `/play/you/` is SERVED rather than redirected, so `usePathname()` reports
  // whatever spelling the browser is on, and `PRIMARY_NAV`'s `match` predicates
  // compare bare paths and document that the caller owes them this call. Same line
  // as the rail and the top bar, so all three agree on a slashed URL.
  const pathname = normalizePath(usePathname() ?? "/");
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

  return (
    <nav
      ref={barRef}
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-white/95 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* One tab per `PRIMARY_NAV` entry, in the table's order — never a
          hand-typed copy of the hrefs or the matching rules. `entry.match` is why:
          Friends lives UNDER the You section, so both tabs would light up on
          `/play/you/friends` if You matched the whole subtree, and that carve-out
          (Friends wins its own route, You covers the rest of the section — profile,
          settings) is stated once, in the table, for all three nav surfaces. The
          copy that used to sit here is exactly the kind that gets "corrected" into
          a two-tabs-lit bug.

          `PHONE_FACE` supplies the label and glyph where the phone's differ; the
          fragment lands in `TabInner`'s own 24x24 `<svg>`, which shares the table's
          24-unit grid but not `NavIcon`'s 20px size. */}
      {PRIMARY_NAV.map((entry) => {
        const face = PHONE_FACE[entry.href];
        return (
          <TabLink
            key={entry.href}
            href={entry.href}
            label={face?.label ?? entry.label}
            active={entry.match(pathname)}
          >
            {face?.icon ?? entry.icon}
          </TabLink>
        );
      })}
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
