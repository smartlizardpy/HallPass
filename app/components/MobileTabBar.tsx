"use client";

/**
 * HallPass mobile — the bottom tab bar.
 *
 * WHY A GLOBAL ISLAND, not part of `ArcadeShell`. The tabs span pages that do NOT
 * share the arcade chrome — `/play/friends` and `/play/account` are standalone
 * `<main>`s with no `ArcadeShell` — so the bar has to live above all of them.
 * Rendering it once in the root layout body (next to `<PWA/>` / `<FeaturePromo/>`)
 * makes it route-agnostic and keeps every page otherwise untouched.
 *
 * WHY IT RENDERS NOTHING ON THE SERVER AND ON DESKTOP. `useDevicePlatform()` is
 * `null` until mounted, so the bar is absent from the prerendered HTML the crawler
 * and the service-worker precache see, and it only appears on the second paint on
 * an actual phone. Desktop never gets it. Same hydration rule as the rest of the
 * mobile shell.
 *
 * ADMIN. There is deliberately no admin tab. The dashboard is reachable from the
 * Account tab (`/play/account` renders a role-gated Dashboard link), so the bar
 * never changes shape based on who is signed in.
 *
 * STEALTH. The phone shell drops the genre hamburger, so the sidebar's "Stealth
 * mode" entry is otherwise unreachable — which left shake-to-panic (a touch-only
 * trigger) impossible to switch on from a phone. The Stealth tab is that door: a
 * button, not a link, because it opens the settings modal `StealthController`
 * owns rather than navigating anywhere.
 */

import { useEffect } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useDevicePlatform } from "../lib/use-device-platform";
import { openStealthSettings } from "../lib/stealth/store";

/** Routes that are their own full-screen world — no player tab bar over them. */
const HIDDEN_PREFIXES = [
  "/dashboard",
  "/play/signin",
  "/play/signout",
  "/play/welcome",
  "/play/auth",
];

export function MobileTabBar() {
  const device = useDevicePlatform();
  const isMobile = device === "mobile";
  const pathname = usePathname() ?? "/";

  const hidden =
    !isMobile || HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));

  // Reserve space at the bottom of every page so the fixed bar never covers the
  // last row of content. Done from here (not in global CSS) so the padding exists
  // exactly when the bar does — on a phone, after mount — and is removed cleanly
  // on desktop or when the bar is hidden.
  useEffect(() => {
    if (hidden) return;
    const prev = document.body.style.paddingBottom;
    document.body.style.paddingBottom =
      "calc(4rem + env(safe-area-inset-bottom))";
    return () => {
      document.body.style.paddingBottom = prev;
    };
  }, [hidden]);

  if (hidden) return null;

  const homeActive = pathname === "/" || pathname.startsWith("/category");
  const friendsActive = pathname.startsWith("/play/friends");
  const accountActive = pathname.startsWith("/play/account");

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-white/95 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <TabLink href="/" label="Home" active={homeActive}>
        <path d="M3 11l9-8 9 8M5 10v10h14V10" />
      </TabLink>

      {/* Two equal heads over one shared base — a symmetric "friends" mark,
          instead of the lopsided big-person/little-person users glyph. */}
      <TabLink href="/play/friends" label="Friends" active={friendsActive}>
        <circle cx="8" cy="8" r="3" />
        <circle cx="16" cy="8" r="3" />
        <path d="M3 20v-1a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v1" />
      </TabLink>

      <TabLink href="/play/account" label="Account" active={accountActive}>
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
      </TabLink>

      {/* Sunglasses — a brow bar over two lenses. Opens the stealth settings
          modal; an action, so a button rather than a link (see the header note). */}
      <TabButton label="Stealth" active={false} onClick={() => openStealthSettings()}>
        <path d="M3 9h18" />
        <path d="M4 9v2a3 3 0 0 0 6 0V9" />
        <path d="M14 9v2a3 3 0 0 0 6 0V9" />
        <path d="M10 10h4" />
      </TabButton>
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
 * so the bar feels responsive even when the destination (e.g. the dynamic account
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
    // four routes warm up ahead of the tap, which is what makes the switch feel
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

function TabButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ touchAction: "manipulation" }}
      className="flex-1 transition active:opacity-50"
    >
      <TabInner label={label} active={active}>
        {children}
      </TabInner>
    </button>
  );
}
