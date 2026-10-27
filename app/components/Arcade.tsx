"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { TRENDING_COUNT, inCategory } from "../lib/categories";
import { type Game } from "../lib/games";
import { useFavorites, useRecentlyPlayed } from "../lib/personalization";
import { mobileCatalog, playsOn, useDevicePlatform } from "../lib/use-device-platform";
import {
  FIRST_SCREEN_COUNT,
  coverUrls,
  preloadBudget,
  preloadImages,
  readConnection,
} from "../lib/mobile-preload";
import { CoverImage } from "./CoverImage";
import { ArcadeShell, useOpenGame } from "./ArcadeShell";
import { GameCard } from "./GameCard";
import { PlatformConfirmSheet, usePlayGuard } from "./PlatformGate";
import { useSearchCapture } from "../lib/use-search-capture";
import { MIN_PLAYS_SHOWN, playsFor } from "../lib/plays";
import { type CatalogSort, sortCatalog } from "../lib/catalog-order";
import { rankForYou } from "../lib/for-you";
import {
  useForYouEnabled,
  useSignedInHint,
  useSignedInSync,
  useTaste,
} from "../lib/taste-store";
import {
  type CatalogView,
  setCatalogSort,
  setCatalogView,
  useCatalogSortChoice,
  useCatalogView,
} from "../lib/catalog-prefs";
import { CatalogToolbar } from "./CatalogToolbar";
import { GameListRow } from "./GameListRow";
import { HauntedHero } from "./events/fright-fest/HauntedHero";
import { EventBoard } from "./events/fright-fest/EventBoard";
import { frightFestGame } from "./events/fright-fest/registry";

/** Rows of the list view before the championship board. */
const LIST_FIRST = 8;

/**
 * How many columns {@link CATALOG_GRID} currently has (2 / 3 / 5 / 7 at the
 * breakpoints it declares), so "two rows" means two ROWS at every width. Starts
 * at the widest layout and corrects after mount, so the prerendered HTML is the
 * same for every visitor and hydration never mismatches.
 */
function useGridColumns(): number {
  const [cols, setCols] = useState(7);
  useEffect(() => {
    const widths = [
      [1280, 7],
      [1024, 5],
      [640, 3],
    ] as const;
    const read = () => {
      const w = window.innerWidth;
      setCols(widths.find(([min]) => w >= min)?.[1] ?? 2);
    };
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return cols;
}

/** Midnight today, local time, in ms. The day the personal order is computed for. */
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* ===================== Catalogue grid ===================== */
/**
 * THE ONE CATALOGUE GRID. Every desktop row — Jump back in, Your favorites, New
 * games, Popular this week, and the filtered All-games grid — renders through
 * this exact string, because five hand-copied class lists is five chances for
 * the rows to disagree about how wide a card is.
 *
 * THE COLUMN COUNTS ARE A MEASUREMENT, NOT A TASTE. `Sidebar` used to be a
 * permanent 240px rail; it is now a 64px icon strip that only reaches 192px when
 * PINNED. That handed the grid ~176px of extra width at 1366px — the school
 * laptop this whole redesign exists for — and the old `lg:grid-cols-4
 * xl:grid-cols-6` spent every pixel of it inflating cards from the ~164px they
 * had always been to 193px, rather than fitting more of them on screen. `lg:5
 * xl:7` spends it the other way round, and 1366px is the width it is tuned for:
 * seven columns is what puts the whole first row — all seven `isNew` games —
 * above the fold instead of six of them plus an orphan on a second row.
 *
 *   width   collapsed rail       pinned rail
 *   1024    5 cols, 166px        5 cols, 141px
 *   1280    7 cols, 151px        7 cols, 133px   <- the narrowest cards ship
 *   1366    7 cols, 163px        7 cols, 145px   <- the target machine
 *   1920    7 cols, 242px        7 cols, 224px
 *
 * BOTH RAIL STATES ARE IN THAT TABLE ON PURPOSE. A pinned rail costs 128px, and
 * the grid cannot see the rail from a `min-width` media query, so every count
 * here has to survive being 128px poorer than it looks. The worst cell is 133px
 * at exactly `xl` with the rail pinned — narrower than the 175px a phone shows,
 * but still a legible truncated title, a readable category line and room for the
 * badge overlay and the 56px hover ▶. That cell is the floor these counts were
 * chosen against, and it is why the ramp stops at seven columns rather than the
 * eight that 1366px collapsed would allow on its own.
 *
 * (Tempting and WRONG: gating the seventh column on `min-[1344px]` so the narrow
 * `xl` band keeps six. Tailwind v4 emits arbitrary `min-[…]` variants BEFORE the
 * named breakpoints, so `xl:grid-cols-6` would simply win at every width above
 * 1344px and the rule would silently do nothing. Verified in the built CSS. Mix
 * named and arbitrary width variants on one property and you get whichever the
 * emitter felt like, not whichever is narrower.)
 */
const CATALOG_GRID =
  "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7";

/**
 * The catalog: featured banner, personalized rows, filter grid.
 *
 * The site chrome (sidebar, header, footer) and the fullscreen player used to
 * live in here too. They now live in `ArcadeShell`, so a page that is not the
 * catalog — a game's store page — can wear the same chrome. `Arcade` owns only
 * what is genuinely catalog state: the active category and the search query.
 */
export function Arcade({
  games,
  categories,
  initialCategory = "All",
  playCounts = {},
  eventBoard,
  board = false,
}: {
  games: Game[];
  categories: string[];
  initialCategory?: string;
  /** Offer Board Mode (the shared-screen sign-in) on this page. */
  board?: boolean;
  playCounts?: Record<string, number>;
  /**
   * What fills the home page's board slot, desktop and phone. The page decides
   * (the theme's `EventBoard`, or a running championship's card) so this
   * catalogue reads neither the championship switch nor its data. Defaults to
   * the theme's card.
   */
  eventBoard?: { desktop: ReactNode; phone: ReactNode };
}) {
  const router = useRouter();
  const [category, setCategoryState] = useState(initialCategory);
  const [query, setQuery] = useState("");

  // Seed the search box from `?q=` — set by the header on pages that have no
  // local grid to filter (see `SiteHeader`). Read from `window.location` in an
  // effect rather than with `useSearchParams`, which would force a Suspense
  // boundary and de-opt this page out of static prerendering — and therefore out
  // of the service-worker precache. Same reasoning as `WelcomeToast`. Running
  // post-mount means the server render is always the empty-query one, so there is
  // no hydration mismatch.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    // The extra render this causes is the POINT, not an oversight: the server
    // render must be the empty-query one (it is prerendered and shared by every
    // visitor), so the seeded value can only appear after hydration. A lazy
    // `useState` initialiser would read the URL during the first client render
    // and mismatch the prerendered HTML.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q) setQuery(q);
  }, []);

  const setCategory = (cat: string) => {
    posthog.capture("category_selected", { category: cat });
    setCategoryState(cat);
    if (cat === "All") router.push("/");
    else router.push(`/category/${encodeURIComponent(cat.toLowerCase())}`);
  };

  return (
    <ArcadeShell
      board={board}
      games={games}
      categories={categories}
      activeCategory={category}
      onSelectCategory={setCategory}
      query={query}
      onQueryChange={setQuery}
    >
      <ArcadeRows
        games={games}
        category={category}
        query={query}
        playCounts={playCounts}
        board={eventBoard ?? { desktop: <EventBoard />, phone: <EventBoard phone /> }}
      />
    </ArcadeShell>
  );
}

/**
 * Everything below the header. Split out from `Arcade` because `useOpenGame` must
 * be called INSIDE the `ArcadeShell` provider that supplies it.
 */
function ArcadeRows({
  games,
  category,
  query,
  playCounts,
  board,
}: {
  games: Game[];
  category: string;
  query: string;
  playCounts: Record<string, number>;
  board: { desktop: ReactNode; phone: ReactNode };
}) {
  const openGame = useOpenGame();

  // Every ▶ on this page goes through the guard rather than straight to
  // `openGame`, so a device-mismatched game asks before it takes over the screen.
  // Games with no tag, and the pre-mount render, pass through untouched.
  const { requestPlay, pending, confirmPlay, cancelPlay } = usePlayGuard(
    games,
    openGame,
  );

  const findGame = (slug: string) => games.find((g) => g.slug === slug);

  // Personalization (localStorage-backed, hydrates AFTER mount via
  // useSyncExternalStore — server snapshot is [] so there is no hydration
  // mismatch). Favorites also sync to Neon for a signed-in player.
  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const { recent } = useRecentlyPlayed();

  const handleToggleFavorite = (slug: string) => {
    const willFavorite = !isFavorite(slug);
    const g = findGame(slug);
    posthog.capture(willFavorite ? "game_favorited" : "game_unfavorited", {
      game_slug: slug,
      game_title: g?.title,
      game_category: g?.category,
    });
    toggleFavorite(slug);
  };

  const featured = games.find((g) => g.isFeatured) ?? games[0];
  const trending = useMemo(
    () =>
      [...games]
        .sort((a, b) => playsFor(b, playCounts) - playsFor(a, playCounts))
        .slice(0, TRENDING_COUNT),
    [games, playCounts],
  );

  // Personalized rows, resolved from slugs → games (a slug whose game has since
  // left the catalogue is dropped). Empty until localStorage hydrates post-mount.
  // Plain consts (not useMemo): the maps are tiny and the compiler handles reuse.
  const isGame = (g: Game | undefined): g is Game => Boolean(g);
  const favoriteGames = favorites.map(findGame).filter(isGame);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return games.filter((g) => {
      if (category === "New" && !g.isNew) return false;
      if (category === "Trending" && !trending.includes(g)) return false;
      if (
        category !== "All" &&
        category !== "New" &&
        category !== "Trending" &&
        !inCategory(g, category)
      )
        return false;
      if (!q) return true;
      return (
        g.title.toLowerCase().includes(q) ||
        g.tagline.toLowerCase().includes(q) ||
        g.tags.some((t) => t.toLowerCase().includes(q)) ||
        g.category.toLowerCase().includes(q)
      );
    });
  }, [category, query, trending, games]);

  // How the filtered grid is ordered and drawn. Both are per-device preferences
  // that read as their defaults until the render after hydration, so the
  // prerendered HTML — the copy in the service-worker precache, shared by every
  // visitor and every crawler — is always the grid as it ships. See
  // `catalog-prefs.ts` for why this is not in the URL.
  const view = useCatalogView();

  const handleSortChange = (next: CatalogSort) => {
    posthog.capture("catalog_sorted", {
      sort: next,
      category,
      searching: query.trim().length > 0,
    });
    setCatalogSort(next);
  };

  const handleViewChange = (next: CatalogView) => {
    posthog.capture("catalog_view_changed", { view: next, category });
    setCatalogView(next);
  };

  // Device-aware ORDER, never device-aware membership. Every game the filter
  // matched is still in this list on every device — search crawlers are mobile
  // clients, so dropping desktop games on a phone would drop them from the index.
  //
  // Three buckets: plays here → not checked yet → known not to work here. While
  // `device` is null (the server render and the first client paint) NO ranking is
  // passed at all, which is what keeps this hydration-safe and keeps the
  // prerendered HTML device-neutral.
  //
  // Where that ranking sits among the keys — outer under the default order, a
  // tiebreak under a chosen one — is `sortCatalog`'s decision and is argued out
  // there, next to the comparators it applies.
  const device = useDevicePlatform();

  // The unfiltered home list: the only one the championship board interrupts.
  const isHome = category === "All" && !query;
  const columns = useGridColumns();
  const gridFirst = columns * 2;

  // THE PERSONAL ORDER. Only for a player who is signed in, has not switched it
  // off in settings, and has shown interest in enough games for an order to mean
  // something (`rankForYou` returns null below that). Everything it reads lives on
  // this device (`taste-store.ts`) and every input reads as empty until the render
  // after hydration, so the prerendered HTML is still the Featured grid.
  //
  // Signing in is the opt-in, so a guest never reaches it. `useSignedInSync`
  // refreshes the signed-in hint from `/api/v1/me`, and learns of a sign-out in
  // time to delete the record before the next person on a shared computer sees it.
  useSignedInSync();
  const signedIn = useSignedInHint();
  const forYouOn = useForYouEnabled();
  const taste = useTaste();
  // Rounded to the day so the order does not reshuffle on every render or visit.
  const [today] = useState(startOfToday);
  const forYou = useMemo(
    () =>
      signedIn && forYouOn
        ? rankForYou({ games, taste, favorites, recent, device, playCounts, today })
        : null,
    [signedIn, forYouOn, games, taste, favorites, recent, device, playCounts, today],
  );
  const forYouRank = useMemo(
    () => (forYou ? new Map(forYou.order.map((slug, i) => [slug, i] as const)) : undefined),
    [forYou],
  );

  // The default order for a player who has never chosen one is "for you", when it
  // is available. An EXPLICIT choice always wins — and an explicit "For you" that
  // has since become unavailable (signed out, switched off) is just Featured.
  const chosen = useCatalogSortChoice();
  const sort: CatalogSort =
    chosen === "foryou" && !forYou ? "featured" : (chosen ?? (forYou ? "foryou" : "featured"));
  const ordered = useMemo(
    () =>
      sortCatalog(filtered, {
        sort,
        playCounts,
        forYou: forYouRank,
        rank: device
          ? (g: Game) => {
              const ok = playsOn(g, device);
              return ok === true ? 0 : ok === null ? 1 : 2;
            }
          : undefined,
      }),
    [filtered, device, sort, playCounts, forYouRank],
  );

  // Report the search from HERE rather than from the header: this is the only
  // component that knows BOTH what was typed and how many games it matched, and
  // the match count is what powers the dashboard's zero-result panel — the one
  // search metric that names the next game to add. Debounced inside the hook, so
  // a player typing "duskfall" produces one event rather than six prefixes.
  useSearchCapture(query, filtered.length);

  // The MOBILE shell: a curated touch arcade, not a re-sorted desktop grid. Only
  // reached on the SECOND paint (device is `null` on the server and first client
  // render, so the shared prerendered HTML stays the full desktop catalogue — the
  // crawler and the service-worker precache both see it). The MobileSplash island
  // covers the swap. Everything shown is confirmed phone-playable, favourites
  // included, so nothing here ever trips the platform interstitial.
  // The phone shell has no sort control, so a player with a personal order simply
  // gets it.
  const mobileGames = useMemo(
    () =>
      mobileCatalog(
        forYouRank ? sortCatalog(filtered, { sort: "foryou", forYou: forYouRank }) : filtered,
      ),
    [filtered, forYouRank],
  );
  if (device === "mobile") {
    return (
      <MobileCatalog
        catalogue={games}
        showEvent={category === "All" && !query}
        eventBoard={board.phone}
        games={mobileGames}
        favorites={mobileCatalog(favoriteGames)}
        onPlay={requestPlay}
        pending={pending}
        confirmPlay={confirmPlay}
        cancelPlay={cancelPlay}
        isFavorite={isFavorite}
        onToggleFavorite={handleToggleFavorite}
      />
    );
  }

  return (
    <>
        {/* Renders nothing until a mismatched ▶ is pressed. */}
        <PlatformConfirmSheet
          game={pending}
          onConfirm={confirmPlay}
          onCancel={cancelPlay}
        />

        {/* Hero / Featured banner. The Fright Fest hero is in the HTML for everyone
            and hidden (`ha-deco`) unless the skin paints; the skin in turn hides
            the regular banner (`data-ha-regular`). CSS decides, so the page with
            the skin off is exactly the regular one. */}
        {category === "All" && !query && (
          <>
            <HauntedHero games={games} />
            <FeaturedBanner game={featured} playCounts={playCounts} />
          </>
        )}
        {/* Pages without a hero get a little night sky instead (skin only). */}
        {!(category === "All" && !query) && <div className="ha-deco ha-stars" aria-hidden="true" />}

        {/* The home page is ONE list (see the "For you" block below): the New games,
            Popular this week, Jump back in, Your favorites rows and the sponsor strip
            are gone, so no game repeats further down the page. */}

        {/* All games / For you / filtered — the one row whose order is the visitor's to
            choose. The toolbar is withheld when nothing matched: controls for
            ordering an empty list are noise on top of a dead end. */}
        <Section
          ghost
          title={
            query
              ? `Results for "${query}"`
              : category === "All"
              ? sort === "foryou" && forYou
                ? "For you"
                : "All games"
              : category
          }
          actions={
            ordered.length > 0 ? (
              <CatalogToolbar
                count={ordered.length}
                sort={sort}
                onSortChange={handleSortChange}
                view={view}
                onViewChange={handleViewChange}
                forYou={forYou !== null}
              />
            ) : null
          }
        >
          <div className="ha-row">
          {sort === "foryou" && forYou && filtered.length > 0 && (
            // Say what the order is and where to change it. This is profiling, even
            // though it never leaves the device, so it is never silent.
            <p className="mb-3 text-[13px] font-semibold text-muted">
              Ordered for you
              {forYou.topInterests.length > 0 ? ` — you like ${forYou.topInterests.join(" and ")} games` : ""},
              from what you play on this device.{" "}
              <Link href="/play/you/settings" className="underline underline-offset-2 hover:text-brand">
                Change this
              </Link>
            </p>
          )}
          <FramedLegend show={ordered.some((g) => frightFestGame(g.slug))} />
          </div>
          {filtered.length === 0 ? (
            <div className="rounded-3xl bg-surface p-16 text-center">
              <p className="text-base font-bold text-muted">
                No games match. Try another search or category.
              </p>
            </div>
          ) : view === "list" ? (
            // A real <ul>: the list layout is a list, and the rows are its
            // items. The grid stays a div because a grid of cards is a layout,
            // not an enumeration — the same distinction the store page's rails
            // make.
            <>
              <ul className="flex flex-col gap-0.5">
                {(isHome ? ordered.slice(0, LIST_FIRST) : ordered).map((g) => (
                  <GameListRow
                    key={g.slug}
                    game={g}
                    onPlay={requestPlay}
                    isFavorite={isFavorite(g.slug)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              </ul>
              {isHome && ordered.length > LIST_FIRST && (
                <>
                  {board.desktop}
                  <div className="ha-deco ha-fence" aria-hidden="true" />
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {ordered.slice(LIST_FIRST).map((g) => (
                      <GameListRow
                        key={g.slug}
                        game={g}
                        onPlay={requestPlay}
                        isFavorite={isFavorite(g.slug)}
                        onToggleFavorite={handleToggleFavorite}
                      />
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <>
              <div className={CATALOG_GRID}>
                {(isHome ? ordered.slice(0, gridFirst) : ordered).map((g) => (
                  <GameCard
                    key={g.slug}
                    game={g}
                    onPlay={requestPlay}
                    isFavorite={isFavorite(g.slug)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              </div>
              {/* The championship board sits after the first two rows and the list
                  carries straight on under it. Hidden (`ha-deco`) unless the skin
                  paints; with it off the two grids are one row-gap (24px) apart,
                  which is exactly the single list. */}
              {isHome && ordered.length > gridFirst && (
                <>
                  {board.desktop}
                  <div className="ha-deco ha-fence" aria-hidden="true" />
                  <div className={`mt-6 ${CATALOG_GRID}`}>
                    {ordered.slice(gridFirst).map((g) => (
                      <GameCard
                        key={g.slug}
                        game={g}
                        onPlay={requestPlay}
                        isFavorite={isFavorite(g.slug)}
                        onToggleFavorite={handleToggleFavorite}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </Section>
    </>
  );
}

/* ===================== Mobile shell ===================== */
/**
 * The phone catalogue: Favourites on top (only when there are any), then the
 * REST of the curated list. No hero, no editorial rows, no genres — "all we need
 * is the games list", per the design. Deliberately sparse.
 *
 * `favorites` and `games` are BOTH already filtered to phone-playable by the
 * caller, so the whole shell keeps one promise: everything on it works under a
 * thumb. A short list is the honest state until more games are tagged.
 *
 * Which is exactly why the two sections must not overlap. `favorites` is a SUBSET
 * of `games` — same mobile-playable set, filtered by the same `mobileCatalog` —
 * so listing both in full showed every favourited game twice, and on a catalogue
 * this short the second section was largely a repeat of the first. "Games" is
 * therefore the remainder, and when the remainder is empty (every phone game
 * favourited) the section is omitted rather than shown empty: its empty state
 * says "no phone games yet", which would be a flat contradiction of the full grid
 * sitting directly above it. That message survives only for the case it was
 * written for — a genuinely empty phone catalogue, where `games` itself is empty.
 */
function MobileCatalog({
  catalogue,
  showEvent,
  eventBoard,
  games,
  favorites,
  onPlay,
  pending,
  confirmPlay,
  cancelPlay,
  isFavorite,
  onToggleFavorite,
}: {
  /** The whole public catalogue (the hero resolves its cabinets from it). */
  catalogue: Game[];
  /** Fright Fest hero + board: the unfiltered phone home only. */
  showEvent: boolean;
  /** The board slot's phone variant (see `Arcade`'s `eventBoard`). */
  eventBoard: ReactNode;
  games: Game[];
  favorites: Game[];
  onPlay: (slug: string) => void;
  pending: Game | null;
  confirmPlay: () => void;
  cancelPlay: () => void;
  isFavorite: (slug: string) => boolean;
  onToggleFavorite: (slug: string) => void;
}) {
  // Everything not already on show in Favourites above. Keyed by slug, which is
  // the catalogue's identity everywhere else in this file (`findGame`, the
  // favourites store, every `key=`), rather than leaning on the two lists
  // happening to hold the same object references.
  const favoriteSlugs = new Set(favorites.map((g) => g.slug));
  const rest = games.filter((g) => !favoriteSlugs.has(g.slug));

  /**
   * Warm the covers this grid is about to paint, in the order it paints them,
   * while `MobileSplash` is still over the top of it.
   *
   * This component is the only place that knows BOTH which games the phone shell
   * lists and what order they are in, which is why the preload is triggered from
   * here rather than from the splash — the splash lives in the root layout and
   * has no catalogue.
   *
   * The first screen is counted so the splash can wait for it (see
   * `pendingFirstScreen`); the remainder is fire-and-forget, and skipped
   * entirely on a data-saver or 2g connection. Those first few are mostly images
   * the browser is fetching anyway — an `Image()` for a URL already in flight
   * costs nothing and simply gives us the `load` event. The real gain is
   * everything after `FIRST_SCREEN_COUNT`, which `GameCard` renders
   * `loading="lazy"` and the browser would not ask for until somebody scrolled.
   */
  const covers = coverUrls([...favorites, ...rest]);
  useEffect(() => {
    preloadImages(covers.slice(0, FIRST_SCREEN_COUNT), { firstScreen: true });
    if (preloadBudget(readConnection()) === "all") {
      preloadImages(covers.slice(FIRST_SCREEN_COUNT));
    }
    // `covers` is rebuilt on every render (both game lists are), so the joined
    // URLs are the dependency that actually changes — otherwise this would re-run
    // on every keystroke in the search box. Re-running is harmless in any case:
    // `preloadImages` dedupes by URL, so a repeat is a walk over a few strings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [covers.join("|")]);

  const grid = (list: Game[]) => (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6">
      {list.map((g) => (
        <GameCard
          key={g.slug}
          game={g}
          onPlay={onPlay}
          isFavorite={isFavorite(g.slug)}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </div>
  );

  return (
    <div className="pb-8">
      {/* Consistent with the desktop path: harmless here since everything shown
          is phone-playable, but kept so the play flow is identical on both. */}
      <PlatformConfirmSheet
        game={pending}
        onConfirm={confirmPlay}
        onCancel={cancelPlay}
      />

      {/* Skin-only: both are `ha-deco`, hidden for everyone else. */}
      {showEvent && <HauntedHero phone games={catalogue} />}

      {favorites.length > 0 && (
        <MobileSection title="Favourites">{grid(favorites)}</MobileSection>
      )}

      {games.length === 0 ? (
        <MobileSection title="Games">
          <div className="rounded-3xl bg-surface p-10 text-center">
            <p className="text-[15px] font-bold text-muted">
              No phone games yet — more are on the way.
            </p>
          </div>
        </MobileSection>
      ) : (
        rest.length > 0 && (
          <MobileSection title="Games" ghost>
            {showEvent && rest.length > 6 ? (
              // The board sits after six games. With the skin off it is hidden and
              // the two grids are one row-gap (24px) apart: the single list.
              <>
                {grid(rest.slice(0, 6))}
                {eventBoard}
                <div className="mt-6">{grid(rest.slice(6))}</div>
                <div className="ha-deco ha-fence" aria-hidden="true" />
              </>
            ) : (
              grid(rest)
            )}
          </MobileSection>
        )
      )}
    </div>
  );
}

/** A slimmer {@link Section} for the phone shell — tighter top padding, a
 *  smaller heading, and no widescreen gutter. */
function MobileSection({
  title,
  children,
  ghost = false,
}: {
  title: string;
  children: React.ReactNode;
  ghost?: boolean;
}) {
  return (
    <section className="px-3 pt-6">
      <h2 className="ha-h mb-4 text-xl font-black tracking-tight text-foreground">
        {title}
        <HeadingDecor ghost={ghost} />
      </h2>
      {children}
    </section>
  );
}

/* ===================== Featured banner ===================== */
/**
 * The promoted game, at the top of the "All" catalogue.
 *
 * ── IT IS SIZED IN `svh`, AND THAT IS THE WHOLE POINT ────────────────────────
 * This banner used to be a POSTER: `sm:p-12`, a `sm:text-6xl` title, a
 * `sm:text-lg` tagline and a hardcoded `min-h-[280px]` floor under the art. On a
 * 27" monitor that is exactly right. On the 1366x768 school laptop the site is
 * actually played on it was 383px of a 768px screen, and it pushed the FIRST ROW
 * OF GAMES to y=568 — a catalogue whose entire job is showing games was showing
 * none of them above the fold.
 *
 * Nothing in the design knew short screens existed: there was not one
 * `max-height`, `svh` or `@media (max-height:)` in the app. Rather than add a
 * height breakpoint (which snaps, and which every later editor has to remember),
 * the four dimensions that actually drive this banner's height are written as
 * `clamp(floor, Nsvh, ceiling)` against the SMALL viewport height:
 *
 *   dimension        clamp                     768px tall   1080px tall
 *   text padding     clamp(20px,4svh,48px)        31px         43px
 *   title size       clamp(30px,4.2svh,60px)      32px         45px
 *   tagline size     clamp(14px,1.9svh,18px)      15px         18px
 *   art floor        clamp(150px,26svh,280px)    200px        280px
 *
 * Every ceiling is the value this banner already had, so a tall screen renders
 * the poster UNCHANGED and only a short one yields. Measured, the banner goes
 * 383px -> ~230px at 768px tall, and the first card row from y=568 to y~400. It
 * degrades further on its own as the screen shortens, which matters because a
 * real 768px laptop loses another ~100px to browser chrome — no extra rule
 * needed, the clamps simply resolve smaller.
 *
 * `sm:max-h-[38svh]` on top of that is a GUARD RAIL, not a layout tool: with the
 * clamps in place the natural height already sits under it (~230px against a
 * 292px cap at 768px tall), so it never bites on today's copy. It exists so a
 * future game with a three-line title cannot quietly grow the banner back into
 * the catalogue's space — the `line-clamp`s below are the first line of that
 * defence and this is the backstop. The `overflow-hidden` it needs is already on
 * the Link.
 *
 * WHAT WAS NOT CUT: the badges, the title, the tagline, the CTA and the cover
 * art are all still here, in the same two-column arrangement — this is a cut,
 * not a deletion. The cover keeps `loading="eager"` / `fetchPriority="high"`
 * because it is still the LCP element (read the comment at the CoverImage), and
 * the Link keeps its default prefetch (read the comment above it).
 */
function FeaturedBanner({
  game,
  playCounts,
}: {
  game: Game;
  playCounts: Record<string, number>;
}) {
  // Resolved through the shared {@link playsFor}, so the headline number and the
  // "Popular this week" ranking are always reading the same figure.
  const plays = playsFor(game, playCounts);

  return (
    <section className="px-3 pt-2 sm:px-8" data-ha-regular>
      {/* Prefetch is left at the DEFAULT (`auto`), deliberately unlike the game
          cards, which opt out with `prefetch={false}`. That opt-out is about
          VOLUME: a screen of 28 cards would warm 28 store pages at once, which
          is real bandwidth on school wifi (`SurpriseButton` documents the
          reasoning). This is ONE link, always above the fold, pointing at the
          single most promoted destination on the site — opting it out bought no
          bandwidth back and cost a cold round trip on the click we most want to
          feel instant. `/game/[slug]` is statically prerendered (see its
          docblock), so the default already prefetches the full route and data;
          `prefetch={true}` would behave identically here and differ only if
          that route ever went dynamic. Do not "consistency-fix" this back to
          match the cards. */}
      <Link
        href={`/game/${game.slug}`}
        onClick={() => {
          // Renamed from `featured_game_played`: this now means "clicked through
          // to the store page", not "started playing". `game_started` is fired
          // by PlayerOverlay and is the only event `app/lib/stats.ts` counts, so
          // the rename cannot double-count or lose plays.
          posthog.capture("featured_game_opened", {
            game_slug: game.slug,
            game_title: game.title,
            game_category: game.category,
          });
        }}
        /* THE DARK BANNER IS A DEEP PANEL, NOT A LIT ONE. `bg-brand` at full
           strength is the right amount of shout against a white page; on a
           near-black one the same fill is the brightest thing on screen by a
           distance, and the `shadow-brand/20` under it becomes a halo. So the
           dark theme drops to `--brand-100` (the deep violet the brand ramp
           already carries there) and swaps the glow for a hairline ring, which
           is what separates a panel from the page when the page is dark. The
           white type, the yellow FEATURED chip and the pill are unchanged —
           they all still read on it. */
        className="group relative grid w-full overflow-hidden rounded-3xl bg-brand text-left shadow-xl shadow-brand/20 dark:bg-brand-100 dark:shadow-none dark:ring-1 dark:ring-brand/40 sm:max-h-[38svh] sm:grid-cols-[1.1fr_1fr]"
        style={{
          // The alphas are theme tokens (`globals.css`); the geometry is not.
          backgroundImage:
            "radial-gradient(circle at 85% 20%, rgba(255,199,0,var(--banner-wash-warm)), transparent 50%), radial-gradient(circle at 15% 90%, rgba(255,79,139,var(--banner-wash-hot)), transparent 55%)",
        }}
      >
        {/* The `sm:` sizes are all viewport-height clamps — see the docblock.
            The base (below `sm`) sizes are untouched: a phone renders
            `MobileCatalog`, which has no banner at all, so the only thing that
            ever sees them is a narrow DESKTOP window. */}
        <div className="relative z-10 flex flex-col justify-center gap-3 p-6 sm:gap-[clamp(8px,1.6svh,16px)] sm:p-[clamp(20px,4svh,48px)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-accent-yellow px-3 py-1 text-[11px] font-black uppercase tracking-wider text-zinc-900">
              ★ Featured
            </span>
            <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-white backdrop-blur">
              {game.category}
            </span>
          </div>
          {/* `line-clamp-2` is the height guard the `max-h` above is the backstop
              for: game titles are dashboard-editable free text, and a three-line
              title would put the banner straight back over the catalogue. Two
              lines is what the longest title in the catalogue needs at 1024px. */}
          <h2 className="line-clamp-2 max-w-xl break-words text-3xl font-black leading-[1.05] tracking-tight text-white sm:text-[clamp(30px,4.2svh,60px)]">
            {game.title}
          </h2>
          <p className="line-clamp-2 max-w-md text-sm font-semibold leading-snug text-white/85 sm:text-[clamp(14px,1.9svh,18px)]">
            {game.tagline}
          </p>
          <div className="mt-1 flex items-center gap-4 sm:mt-2">
            {/* "View game", NOT "Play now" — the whole banner is a Link to the
                store page and nothing here launches the player, which is the
                intended behaviour (see the capture comment above). The label and
                the chevron both describe the click that actually happens; a play
                triangle promised a launch the banner never delivered. Anyone
                tempted to put "Play now" back has to rewire the banner first. */}
            {/* `py-3.5 text-base` made this 52px tall — 8px more than the 44px
                `min-h-11` already guarantees, i.e. 8px of banner height bought
                nothing. `py-3 text-[15px]` lands exactly ON the 44px floor, so
                the tap target is unchanged and the pill still reads as the
                chunky primary action. */}
            {/* Literal white, not `bg-surface`: the pill sits on the
                brand-purple banner, which is the same purple in either theme, so
                a pill that followed the page would invert underneath it. */}
            <span className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-6 py-3 text-[15px] font-extrabold text-brand shadow-2xl transition group-hover:scale-105">
              View game
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4.5 1.5L10 7l-5.5 5.5" />
              </svg>
            </span>
            {/* Omitted below {@link MIN_PLAYS_SHOWN} — see that constant. */}
            {plays >= MIN_PLAYS_SHOWN && (
              <span className="hidden text-[13px] font-bold text-white/80 sm:inline">
                {plays.toLocaleString()} plays
              </span>
            )}
          </div>
        </div>
        {/* The art column's floor. A flat `min-h-[280px]` was 36% of a 768px
            screen spent on one cover, and — because it exceeded what the text
            column needed — it was frequently the thing SETTING the banner's
            height. Clamped, it keeps the full 280px wherever there is room for
            it and relaxes to 200px at 768px tall / 150px on anything shorter. */}
        <div className="relative hidden h-full min-h-[clamp(150px,26svh,280px)] sm:block">
          <div className="absolute inset-4 overflow-hidden rounded-2xl bg-zinc-900">
            {/* The featured banner is above the fold: load its cover eagerly and
                at high priority, since it is the page's LCP candidate. */}
            <CoverImage
              game={game}
              initialClass="text-6xl"
              loading="eager"
              fetchPriority="high"
            />
          </div>
        </div>
      </Link>
    </section>
  );
}

/* ===================== Fright Fest decoration slots ===================== */
/** Pumpkin at the end of the heading's dashed rule, plus (once per page) a ghost
 *  behind the heading. Both are `ha-deco`: hidden for everyone, shown by the skin. */
function HeadingDecor({ ghost }: { ghost: boolean }) {
  return (
    <>
      {ghost && (
        <span className="ha-deco ha-hgwrap" aria-hidden="true" data-ha-moment="ghost-heading">
          <span className="ha-hghost">
            <span className="ha-spr ha-s-ghost" />
          </span>
        </span>
      )}
      <span className="ha-deco ha-hpump ha-spr" aria-hidden="true" />
    </>
  );
}

/** The key for the framed registry games. Neutral while the competition is off:
 *  it says what the frame IS, never that the game counts toward anything. */
function FramedLegend({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="ha-deco ha-legend">
      <span className="mk" aria-hidden="true" />
      Framed games are the Fright Fest cabinets
    </span>
  );
}

/* ===================== Section wrapper ===================== */
/**
 * One titled catalogue row.
 *
 * The two spacings here are height-clamped for the same reason the banner's are
 * (see {@link FeaturedBanner}): between the header and the first card sit a
 * 40px section pad and a 20px heading margin, and on a 768px screen those 60px
 * are a quarter of a card. Both keep their original value as the CEILING, so a
 * tall screen is spaced exactly as before and only a short one tightens — 31px
 * and 15px at 768px tall, which is 14px back for every row on the page.
 *
 * The heading's own type size is deliberately NOT clamped. It is the label that
 * tells you which row you are looking at, and 28px is already the smallest it
 * reads well at; the 6px available was not worth a wobbling heading.
 */
function Section({
  title,
  actions,
  children,
  ghost = false,
}: {
  title: string;
  /** Fright Fest: a ghost that hides behind this heading (skin-only decoration). */
  ghost?: boolean;
  /**
   * Controls for this row, laid out opposite the heading. Only the filtered
   * grid passes any: the curated rows each mean one specific thing, and their
   * order IS that meaning, so there is nothing for a visitor to decide on them.
   */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="px-3 pt-[clamp(20px,4svh,40px)] sm:px-8">
      {/* The clamped bottom margin moved from the <h2> to this row so that a
          section WITHOUT actions is spaced to the pixel as it was before the
          row existed. `flex-wrap` is what makes the toolbar drop to its own
          line rather than squeeze the heading on a narrow desktop window. */}
      <div className="mb-[clamp(12px,2svh,20px)] flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2 className="ha-h text-2xl font-black tracking-tight text-foreground sm:text-[28px]">
          {title}
          <HeadingDecor ghost={ghost} />
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
