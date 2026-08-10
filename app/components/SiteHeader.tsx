"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { captureSearchNow } from "../lib/use-search-capture";
import { useDevicePlatform } from "../lib/use-device-platform";
import { AccountMenu } from "./AccountMenu";
import { StreakChip } from "./streak/StreakChip";
import { WhatsNewLink } from "./WhatsNewLink";
import { Wordmark } from "./Wordmark";

/**
 * The public sticky header: hamburger, narrow-desktop wordmark, search, What's
 * New, account menu.
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
 * THE BAR IS CHROME, SO IT IS WHITE. It used to fill with `bg-background/85` —
 * the same `#f4f4f7` as the page scrolling beneath it — which left a hairline
 * border doing all the work while the rail next door announced itself with
 * `bg-white` + `border-r`. It now fills with `bg-surface/85` and keeps the blur
 * and the bottom border, so the two pieces of chrome read as one L around the
 * content canvas, and `--background` goes back to meaning "canvas" only.
 *
 * That white fill is why every control in here sits on `bg-surface-2` rather
 * than the `bg-white` they all used to wear: white-on-white would erase them.
 * Two knock-on rules for anything added to this bar later:
 *   - Text on `--surface-2` cannot use `--muted` — 4.45:1, just under AA — so
 *     the placeholder takes `text-zinc-600` (6.57:1). Icons may stay `--muted`,
 *     which clears the 3:1 non-text floor comfortably.
 *   - Floating layers (the account dropdown, the streak popover) stay WHITE.
 *     They sit above the page, not on the bar.
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
  // shell has no genres — and the wordmark, leaving the row to the search field.
  const isMobile = useDevicePlatform() === "mobile";

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
        className="h-11 w-full rounded-full bg-surface-2 pl-11 pr-4 text-base font-semibold text-zinc-900 placeholder:text-zinc-600 outline-none transition focus:ring-4 focus:ring-brand/20 sm:h-auto sm:py-3.5 sm:pl-12 sm:pr-5 sm:text-[15px]"
      />
    </div>
  );

  return (
    <header
      className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-border bg-surface/85 px-3 backdrop-blur-xl sm:h-20 sm:gap-4 sm:px-8"
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
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-zinc-800 transition hover:text-brand lg:hidden"
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

      {/* Narrow-desktop wordmark — was an `<a href="#">`, which went nowhere.
          Dropped on a real phone (`isMobile`): the mark plus its "MOBILE" tag
          ate roughly 45% of the header row and clipped the search placeholder,
          and the phone already has its way home in the bottom tab bar. It stays
          for a narrow DESKTOP window (device `desktop`, or the pre-mount
          `null`), where the sidebar is hidden below `lg` and this is the only
          link back to home. */}
      {!isMobile && (
        <Link href="/" className="lg:hidden">
          <Wordmark size="text-xl sm:text-2xl" />
        </Link>
      )}

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

      {/* On a phone the account lives in the bottom tab bar and What's New is
          noise, so both come off the header — which is what gives the search
          field the whole row instead of a cramped sliver. Desktop keeps them.
          The streak flame stays, though: it's the one bit of the cluster worth
          the space on mobile, and the phone header is otherwise its only home. */}
      {isMobile ? (
        <div className="ml-1 shrink-0">
          <StreakChip />
        </div>
      ) : (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <StreakChip />
          <WhatsNewLink />
          <AccountMenu />
        </div>
      )}
    </header>
  );
}
