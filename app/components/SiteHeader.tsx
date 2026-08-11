"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import type { Game } from "../lib/games";
import { captureSearchNow } from "../lib/use-search-capture";
import { useDevicePlatform } from "../lib/use-device-platform";
import { AccountMenu } from "./AccountMenu";
import { PRIMARY_NAV, normalizePath } from "./primary-nav";
import { StreakChip } from "./streak/StreakChip";
import { SurpriseButton } from "./SurpriseButton";
import { WhatsNewLink } from "./WhatsNewLink";
import { Wordmark } from "./Wordmark";

/**
 * The public sticky header: hamburger, wordmark, the primary nav tabs, search,
 * Surprise me, What's New, account menu.
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
 * THE HEADER IS A HORIZONTAL BUDGET. The rail was a vertical one — it could
 * afford an icon in front of every row because it had a whole column and only
 * ~192px of width to fill. In here every pixel a control takes comes straight
 * out of the search field, which is the one control the bar exists for. That
 * single fact decides the three sizing calls made below:
 *
 *   1. THE TABS ARE LABEL-ONLY. `PRIMARY_NAV` ships an `icon` per entry and the
 *      rail draws it, but three 20px glyphs plus their gaps cost ~96px here and
 *      buy nothing: "Games", "Friends" and "You" are short, unambiguous words
 *      sitting inline on one line, not a vertical scan-column of twenty rows
 *      where a glyph is what your eye actually lands on. So this surface uses
 *      `href`/`label`/`match` and deliberately ignores `icon` — which is why it
 *      does not import `NavIcon`. If icons ever come back, they must be wrapped
 *      in `NavIcon`; the fragments are drawn for that wrapper's 24-unit grid and
 *      are meaningless without it.
 *   2. THE TABS ARE `lg`-AND-UP ONLY. Below `lg` the hamburger opens the drawer,
 *      which renders the same three from the same table, and on a real phone the
 *      `MobileTabBar` carries them. Three tabs wedged beside a search field on a
 *      narrow screen is precisely the crowding this redesign exists to undo.
 *   3. THE SEARCH FIELD IS PROTECTED BY SUBTRACTION, NOT BY A `min-width`. It is
 *      the only flexible item in the row (`flex-1 min-w-0`; everything else is
 *      `shrink-0` and the tab labels are `whitespace-nowrap`, so nothing can
 *      wrap to a second line) — which means it absorbs every pixel added
 *      elsewhere. A `min-w-*` floor on it would NOT help: the row's other items
 *      are fixed-size pills, so an unsatisfiable floor does not reserve width,
 *      it just pushes the account button out past the padding and into `main`'s
 *      `overflow-x-clip`. The only real protection is to keep the competitors
 *      small, so in the `lg`..`xl` band — the tightest one, because the 192px
 *      rail is still on screen there — the wordmark drops to `text-xl` and
 *      "What's New" collapses to its icon, both back to full size at `xl`.
 *   4. "SURPRISE ME" IS AN ICON, AND DESKTOP-ONLY. It arrived here from the rail,
 *      where it was a full-width gradient button with a label; in this row it is
 *      a 44px die, 52px with the gap — because a labelled pill would cost ~140px
 *      of the search field for an action nobody is hunting for by name. That die
 *      is now the control's ONLY shape (`SurpriseButton` dropped the rail one
 *      with its last caller), so there is no variant to select here. It is also inside the `isMobile ? …` else-branch
 *      on purpose: see the note on that branch.
 *      Remeasured at 1024x768 signed-out with the rail and the die present:
 *      search 167px (it was 219px), and the ROW still does not overflow — the
 *      document is exactly 1024px wide. What the 52px does cost is the tail of
 *      the placeholder: "Search games" needs 101px of text box and gets 99px at
 *      exactly 1024, so the final glyph clips. That is a 2px shortfall in a band
 *      2px wide — 1026px viewport upward it fits, because the field is the only
 *      thing in the row that grows — so it is accepted rather than paid for by
 *      hiding the die in the `lg`..`xl` band, which is the only lever left and
 *      would take Surprise off the whole 1024–1279 range where the rail no longer
 *      offers it either. Signed in the field is ~60px narrower again (the account
 *      trigger carries a handle); still no row overflow, which is the property
 *      that matters.
 *
 * NEITHER THE TABS NOR THE WORDMARK NOR THE DIE IS DUPLICATED ANY MORE. All three
 * were briefly drawn twice — once here, once in `Sidebar` — so that the phase that
 * added them to this bar could land without a commit in between where the site had
 * no way home. `Sidebar` has since dropped all three, so this bar is the only
 * surface that draws them on desktop and `PRIMARY_NAV` has exactly two consumers
 * left: this header, and `MobileTabBar` on a phone. What the rail still owns is the
 * genre filter and the stealth button.
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
  games,
  query,
  onQueryChange,
}: {
  navOpen: boolean;
  onOpenNav: () => void;
  /**
   * The catalogue, used only to pick a random game for "Surprise me" — the die in
   * the control cluster. It arrives as a PROP from `ArcadeShell`, which already
   * holds the same array for the player overlay, rather than being fetched here:
   * this component must stay prerender-safe (no fetching, no session state) so the
   * pages that mount it keep their place in `prerender-manifest.json` and hence in
   * the service-worker precache. Threading one array through beats a second data
   * source, and `SurpriseButton` only ever reads `slug` off it.
   */
  games: Game[];
  /** Supply with `onQueryChange` for live filtering; omit for navigate-on-submit. */
  query?: string;
  onQueryChange?: (value: string) => void;
}) {
  const router = useRouter();
  const controlled = typeof query === "string" && Boolean(onQueryChange);

  // Same source of truth for "which tab is lit" as the rail: the live pathname,
  // normalised, then each entry's own `match`. Not a prop — the header is
  // rendered once by `ArcadeShell` for every page, so nothing upstream knows
  // which destination is current. `usePathname` re-renders on client-side
  // navigation, and it is prerender-safe here (no `cacheComponents`, and the
  // only rewrites in `next.config.ts` are for `/ingest`, not page routes).
  const path = normalizePath(usePathname() ?? "/");

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
          pre-mount `null`) still gets it, so keyboard users keep the drawer.

          "Open categories", not the "Open menu" it used to say. The name has to
          describe what opens, and what opens is now only the genre list plus the
          stealth hatch — `Sidebar`'s drawer dropped the primary destinations when
          the tabs above landed here, and its `role="dialog"` is labelled
          "Categories" to match. `aria-controls` still points at `mobile-nav`,
          which is that drawer's container id. */}
      {!isMobile && (
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open categories"
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

      {/* Desktop wordmark — was an `<a href="#">`, which went nowhere.
          NO LONGER `lg:hidden`. It used to yield to the rail's own mark at `lg`,
          because up there the rail was the site's link home; the rail is being
          retired, so the bar has to carry the mark at every desktop width or
          there is nothing to click at the top-left of a wide screen. Until that
          later phase lands both marks are on screen at `lg` — deliberate, same
          bargain as the duplicated nav.

          STILL DROPPED ON A REAL PHONE (`isMobile`), and that has not been
          relaxed: the measurement in the original note stands — the mark plus
          its "MOBILE" tag ate roughly 45% of a 390px header row and clipped the
          search placeholder — and nothing here buys that width back, since the
          tabs beside it are `lg`-only. The phone keeps its way home in the
          bottom tab bar. A narrow DESKTOP window (device `desktop`, or the
          pre-mount `null`) keeps the mark as before.

          `lg:text-xl` rather than growing with the row: at `lg` the tabs move in
          beside it and the 2xl mark's extra ~20px would come out of the search
          field. It goes back up at `xl`, where there is room. */}
      {!isMobile && (
        <Link href="/" className="shrink-0">
          <Wordmark size="text-xl sm:text-2xl lg:text-xl xl:text-2xl" />
        </Link>
      )}

      {/* The primary destinations, `lg` and up. Rendered from `PRIMARY_NAV` —
          never a hand-typed copy of the hrefs, labels or `match` rules, which is
          the whole reason that module exists. Real `<Link>`s, so middle-click,
          ⌘-click and "open in new tab" behave; `aria-current="page"` and the
          `bg-brand-50 text-brand` fill are the same active treatment the rail
          gives the same three, so the two surfaces cannot disagree about which
          one is lit.

          Gated on WIDTH (`lg:`), not on `isMobile` like the wordmark and the
          hamburger either side of it. That is deliberate: the rail these mirror
          is width-gated too, so on the one device where the two rules disagree —
          a coarse-pointer tablet wide enough for `lg` — the tabs appear exactly
          when the rail does, instead of inventing a third behaviour. A phone
          never reaches `lg`, so its `MobileTabBar` stays the only copy there.

          `h-11` matches every other pill in this bar (search, What's New,
          account) so the row has one control height. Text is `text-zinc-700`,
          not `--muted`: these sit on the white bar, and an idle tab that hovers
          onto `--surface-2` would land on the 4.45:1 pair the docblock above
          rules out. */}
      <nav aria-label="Primary" className="hidden shrink-0 lg:block">
        <ul className="flex items-center gap-1">
          {PRIMARY_NAV.map((entry) => {
            const isActive = entry.match(path);
            return (
              <li key={entry.href}>
                <Link
                  href={entry.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex h-11 items-center whitespace-nowrap rounded-full px-3 text-[15px] font-bold transition xl:px-4 ${
                    isActive
                      ? "bg-brand-50 text-brand"
                      : "text-zinc-700 hover:bg-surface-2 hover:text-zinc-900"
                  }`}
                >
                  {entry.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

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
          the space on mobile, and the phone header is otherwise its only home.

          "SURPRISE ME" IS DESKTOP-ONLY, i.e. it stays out of the `isMobile`
          branch. Three reasons, in order of weight:
            - A PHONE NEVER HAD IT. The die only ever rendered inside `Sidebar`'s
              `navList`, and on a real phone the rail is `hidden` below `lg` while
              the hamburger that opens the drawer is itself suppressed by
              `isMobile` (see the note on that button) — so the drawer is
              unreachable and the die was already dead on that device. Adding it
              here would be a NEW phone feature smuggled into a de-duplication
              change, not the preservation of an existing one.
            - THE ROW CANNOT PAY FOR IT. 44px plus its gap is ~52px of a 390px
              header, and the whole reason the wordmark and its tag were dropped
              on mobile was that they clipped the search placeholder. Spending
              that width back on a second control undoes the fix.
            - ITS ARMING IS HOVER-DRIVEN. `SurpriseButton` prefetches the route it
              picked on `pointerenter`/`focus`; a touch device never hovers, so it
              gets the cold path anyway — the control is at its least valuable
              exactly where it is most expensive.
          If Surprise ever wants a phone home it belongs in the mobile shell's own
          furniture, not wedged into the one row the search field needs. */}
      {isMobile ? (
        <div className="ml-1 shrink-0">
          <StreakChip />
        </div>
      ) : (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* FIRST in the cluster, not last. The die is the only ACTION in a row
              of status and account controls, and `AccountMenu` has to stay
              rightmost — that corner is where every site puts the account, and
              its dropdown is anchored there. Sitting immediately after the search
              field also keeps it next to the other "find me something" control,
              which is what it is: search's opposite, for when you have nothing to
              type. */}
          <SurpriseButton games={games} />
          <StreakChip />
          {/* "What's New" goes icon-only for exactly the `lg`..`xl` band, where
              the tabs have just moved in and the rail is still taking 192px:
              its label is ~87px, which is the difference between a search field
              you can read a query in and one you cannot. This is not a new
              behaviour, it is the SAME collapse `WhatsNewLink` already does
              below `sm` (`hidden sm:inline` on its label) applied to one more
              band, and the pill keeps its `title` and `aria-label`, so the
              affordance survives — nothing is removed from the row.

              Done from out here with a child selector rather than by editing
              `WhatsNewLink`, because the pressure is this bar's, not the link's:
              the same component in the dashboard rail has no such problem. The
              selector matches the label span only (the sparkle is an `<svg>`),
              and outranks the component's own `sm:inline` on specificity, so
              source order between the two is not load-bearing. */}
          <span className="flex lg:[&>a>span]:hidden xl:[&>a>span]:inline">
            <WhatsNewLink />
          </span>
          <AccountMenu />
        </div>
      )}
    </header>
  );
}
