"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { captureSearchNow } from "../lib/use-search-capture";
import { useDevicePlatform } from "../lib/use-device-platform";
import { AccountMenu } from "./AccountMenu";
import { WhatsNewLink } from "./WhatsNewLink";
import { Wordmark } from "./Wordmark";

/**
 * The public sticky header: hamburger, mobile wordmark, search, What's New,
 * account menu.
 *
 * Lifted out of `Arcade` so every public page wears the same chrome. It has TWO
 * search modes, and which one you get depends on whether the parent owns a query:
 *
 *   CONTROLLED (`query` + `onQueryChange` supplied) — the catalog pages. Typing
 *   filters the grid live with no navigation, exactly as before.
 *
 *   UNCONTROLLED (neither supplied) — pages with nothing to filter, like a game's
 *   store page. The input becomes a form that navigates to `/?q=…` on submit.
 *   Deliberately on SUBMIT rather than per keystroke: pushing a route on every
 *   character would be a navigation storm.
 *
 * Why `/?q=` and not a `/search` route: the home page reads that param
 * CLIENT-SIDE from `window.location.search` after mount. Reading it server-side
 * (via `searchParams`) would make `app/page.tsx` dynamic, which drops it out of
 * `prerender-manifest.json`, which drops it out of the service-worker precache in
 * `scripts/build-sw-manifest.mjs`. That is the same reason `WelcomeToast` avoids
 * `useSearchParams`.
 *
 * The `paddingTop: env(safe-area-inset-top)` is load-bearing on installed iOS
 * PWAs — without it the header sits under the status bar.
 */
export function SiteHeader({
  navOpen,
  onOpenNav,
  query,
  onQueryChange,
}: {
  navOpen: boolean;
  onOpenNav: () => void;
  /** Supply with `onQueryChange` for live filtering; omit for navigate-on-submit. */
  query?: string;
  onQueryChange?: (value: string) => void;
}) {
  const router = useRouter();
  const controlled = typeof query === "string" && Boolean(onQueryChange);

  // `null` on the server and first paint, so the header hydrates identical to the
  // prerender and only takes on its phone form on the second paint (same rule as
  // the catalogue swap). On a real phone we drop the genre hamburger — the mobile
  // shell has no genres — and brand the mark "hallpass · mobile".
  const isMobile = useDevicePlatform() === "mobile";

  // The bottom tab bar's Search tab navigates to `/#search`; this focuses the
  // input when that hash arrives (on mount after navigation, or via hashchange
  // when already on the page), then clears the hash so a repeat tap re-triggers.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focusFromHash = () => {
      if (window.location.hash !== "#search") return;
      searchRef.current?.focus();
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    };
    focusFromHash();
    window.addEventListener("hashchange", focusFromHash);
    return () => window.removeEventListener("hashchange", focusFromHash);
  }, []);

  const searchInput = (
    <div className="relative ml-1 min-w-0 flex-1 max-w-2xl sm:ml-0">
      <svg
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted sm:left-5"
        width="18"
        height="18"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <circle cx="7" cy="7" r="5" />
        <path d="m14 14-3-3" strokeLinecap="round" />
      </svg>
      <input
        ref={searchRef}
        type="search"
        name="q"
        inputMode="search"
        autoComplete="off"
        {...(controlled
          ? {
              value: query,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                // No analytics here. `ArcadeRows` reports the search, because it
                // is the only component that also knows how many games matched —
                // and the match count is what makes the zero-result panel work.
                onQueryChange!(e.target.value);
              },
            }
          : {})}
        placeholder="Search games"
        aria-label="Search games"
        className="h-11 w-full rounded-full bg-white pl-11 pr-4 text-base font-semibold text-zinc-900 placeholder:text-muted outline-none transition focus:ring-4 focus:ring-brand/20 sm:h-auto sm:py-3.5 sm:pl-12 sm:pr-5 sm:text-[15px]"
      />
    </div>
  );

  return (
    <header
      className="sticky top-0 z-40 flex h-16 items-center gap-2 bg-background/85 px-3 backdrop-blur-xl sm:h-20 sm:gap-4 sm:px-8"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Mobile hamburger — opens the genre drawer. Hidden on an actual phone
          (`isMobile`): the mobile shell has no genres and navigates via the
          bottom tab bar. A narrow DESKTOP window (device `desktop`, or the
          pre-mount `null`) still gets it, so keyboard users keep the drawer. */}
      {!isMobile && (
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open menu"
          aria-expanded={navOpen}
          aria-controls="mobile-nav"
          style={{ touchAction: "manipulation" }}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-zinc-800 transition hover:text-brand lg:hidden"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            className="pointer-events-none"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      )}

      {/* Mobile wordmark — was an `<a href="#">`, which went nowhere. Branded
          "hallpass · mobile" on a real phone. */}
      <Link href="/" className="lg:hidden">
        <Wordmark size="text-xl sm:text-2xl" tag={isMobile ? "mobile" : undefined} />
      </Link>

      {controlled ? (
        searchInput
      ) : (
        <form
          role="search"
          // `action`/`method` so the form works BEFORE hydration and with JS off:
          // a native GET to `/` with the `q` field is exactly the URL the onSubmit
          // handler builds. Without them a pre-hydration submit would reload the
          // CURRENT page instead of searching.
          action="/"
          method="get"
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            const value = String(
              new FormData(e.currentTarget).get("q") ?? "",
            ).trim();
            captureSearchNow(value);
            router.push(value ? `/?q=${encodeURIComponent(value)}` : "/");
          }}
        >
          {searchInput}
        </form>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <WhatsNewLink />
        <AccountMenu />
      </div>
    </header>
  );
}
