"use client";

/**
 * HallPass mobile — the bottom tab bar.
 *
 * WHY A GLOBAL ISLAND, not part of `ArcadeShell`. The tabs span pages that do NOT
 * share the arcade chrome — `/play/friends` and `/play/account` are standalone
 * `<main>`s with no `ArcadeShell` — so the bar has to live above all of them.
 * Rendering it once in the root layout body (next to `<PWA/>` / `<InstallPrompt/>`)
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
 * stays four items for everyone and never changes shape based on who is signed in.
 */

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDevicePlatform } from "../lib/use-device-platform";

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
  const router = useRouter();

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

  // The Search tab is an action, not a destination: it focuses the header search
  // field via the `#search` hash that `SiteHeader` listens for. From another
  // route we navigate home first; already home, we set the hash directly (forcing
  // a change even if it was still `#search`) so the field re-focuses every tap.
  const goSearch = useCallback(() => {
    if (window.location.pathname === "/") {
      if (window.location.hash === "#search") {
        history.replaceState(null, "", "/");
      }
      window.location.hash = "search";
    } else {
      router.push("/#search");
    }
  }, [router]);

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

      <TabButton label="Search" active={false} onClick={goSearch}>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" strokeLinecap="round" />
      </TabButton>

      <TabLink href="/play/friends" label="Friends" active={friendsActive}>
        <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M15 21v-2a4 4 0 0 0-3-3.87" />
      </TabLink>

      <TabLink href="/play/account" label="Account" active={accountActive}>
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
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      style={{ touchAction: "manipulation" }}
      className="flex-1"
    >
      <TabInner label={label} active={active}>
        {children}
      </TabInner>
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
      className="flex-1"
    >
      <TabInner label={label} active={active}>
        {children}
      </TabInner>
    </button>
  );
}
