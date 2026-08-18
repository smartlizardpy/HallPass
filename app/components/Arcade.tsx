"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { TRENDING_COUNT } from "../lib/categories";
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

/* ===================== Play counts ===================== */
/**
 * The catalogue's ONE play-count resolution: the live count from
 * `app/lib/stats.ts` first, the static seed in `app/lib/games.ts` second, zero
 * last.
 *
 * Shared rather than written out at each call site so the Trending ranking and
 * the featured banner can never disagree. They used to: the banner read
 * `game.plays` directly, so a game with no seed — the featured one, as it
 * happens — was advertised as "0 plays" while the row beside it ranked on the
 * live number. `app/game/[slug]/page.tsx` resolves its own copy the same way.
 */
function playsFor(game: Game, playCounts: Record<string, number>): number {
  return playCounts[game.slug] ?? game.plays ?? 0;
}

/**
 * Below this many plays the featured banner prints no play count at all.
 *
 * The hero is the first copy a new visitor reads, and a genuinely small number
 * there is worse than silence: "3 plays" on the page whose job is to make the
 * arcade look worth staying on tells everyone the arcade is dead. A newly
 * promoted game, or one whose live count has not accumulated yet, therefore
 * drops the line entirely — no placeholder, no "New" substitute, since either
 * would only point at the number that is missing.
 */
const MIN_PLAYS_SHOWN = 50;

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
}: {
  games: Game[];
  categories: string[];
  initialCategory?: string;
  playCounts?: Record<string, number>;
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
}: {
  games: Game[];
  category: string;
  query: string;
  playCounts: Record<string, number>;
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
  const newGames = useMemo(() => games.filter((g) => g.isNew), [games]);

  // Personalized rows, resolved from slugs → games (a slug whose game has since
  // left the catalogue is dropped). Empty until localStorage hydrates post-mount.
  // Plain consts (not useMemo): the maps are tiny and the compiler handles reuse.
  const isGame = (g: Game | undefined): g is Game => Boolean(g);
  const jumpBackIn = recent.map(findGame).filter(isGame).slice(0, 4);
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
        g.category !== category
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

  // Device-aware ORDER, never device-aware membership. Every game the filter
  // matched is still in this list on every device — search crawlers are mobile
  // clients, so dropping desktop games on a phone would drop them from the index.
  //
  // Three buckets, STABLE within each so the existing ranking survives: plays
  // here → not checked yet → known not to work here. While `device` is null (the
  // server render and the first client paint) the list is returned untouched,
  // which is what keeps this hydration-safe and keeps the prerendered HTML — the
  // copy sitting in the service-worker precache — device-neutral.
  const device = useDevicePlatform();
  const ordered = useMemo(() => {
    if (!device) return filtered;
    const rank = (g: Game) => {
      const ok = playsOn(g, device);
      return ok === true ? 0 : ok === null ? 1 : 2;
    };
    // `map`+`sort` on index keeps ties in their original order. Array.prototype
    // .sort is specified as stable, but the explicit tiebreak documents that the
    // ordering inside a bucket is load-bearing rather than incidental.
    return filtered
      .map((g, i) => ({ g, i }))
      .sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
      .map(({ g }) => g);
  }, [filtered, device]);

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
  const mobileGames = useMemo(() => mobileCatalog(filtered), [filtered]);
  if (device === "mobile") {
    return (
      <MobileCatalog
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

        {/* Hero / Featured banner */}
        {category === "All" && !query && (
          <FeaturedBanner game={featured} playCounts={playCounts} />
        )}

        {/* Jump back in — recently played (per-device). Appears post-hydration. */}
        {category === "All" && !query && jumpBackIn.length > 0 && (
          <Section title="Jump back in">
            <div className={CATALOG_GRID}>
              {jumpBackIn.map((g) => (
                <GameCard
                  key={g.slug}
                  game={g}
                  onPlay={requestPlay}
                  isFavorite={isFavorite(g.slug)}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
          </Section>
        )}

        {/* Your favorites — local for everyone, server-synced when signed in. */}
        {category === "All" && !query && favoriteGames.length > 0 && (
          <Section title="Your favorites">
            <div className={CATALOG_GRID}>
              {favoriteGames.map((g) => (
                <GameCard
                  key={g.slug}
                  game={g}
                  onPlay={requestPlay}
                  isFavorite={isFavorite(g.slug)}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
          </Section>
        )}

        {/* New row */}
        {category === "All" && !query && newGames.length > 0 && (
          <Section title="New games">
            <div className={CATALOG_GRID}>
              {newGames.map((g) => (
                <GameCard
                  key={g.slug}
                  game={g}
                  onPlay={requestPlay}
                  isFavorite={isFavorite(g.slug)}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
          </Section>
        )}

        {/* The home page's ONE sponsor strip. There were three: two of them the
            same advertiser at the same URL under different copy, plus a slot
            below the grid, so scrolling the page meant passing an ad three
            times. One placement, mid-page, between the editorial rows. */}
        {category === "All" && !query && <FrenchlyAd />}

        {/* Trending row */}
        {category === "All" && !query && (
          <Section title="Popular this week">
            <div className={CATALOG_GRID}>
              {trending.slice(0, TRENDING_COUNT).map((g) => (
                <GameCard
                  key={g.slug}
                  game={g}
                  onPlay={requestPlay}
                  isFavorite={isFavorite(g.slug)}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
          </Section>
        )}

        {/* All games / filtered */}
        <Section
          title={
            query
              ? `Results for "${query}"`
              : category === "All"
              ? "All games"
              : category
          }
        >
          {filtered.length === 0 ? (
            <div className="rounded-3xl bg-white p-16 text-center">
              <p className="text-base font-bold text-muted">
                No games match. Try another search or category.
              </p>
            </div>
          ) : (
            <div className={CATALOG_GRID}>
              {ordered.map((g) => (
                <GameCard
                  key={g.slug}
                  game={g}
                  onPlay={requestPlay}
                  isFavorite={isFavorite(g.slug)}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
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
  games,
  favorites,
  onPlay,
  pending,
  confirmPlay,
  cancelPlay,
  isFavorite,
  onToggleFavorite,
}: {
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

      {favorites.length > 0 && (
        <MobileSection title="Favourites">{grid(favorites)}</MobileSection>
      )}

      {games.length === 0 ? (
        <MobileSection title="Games">
          <div className="rounded-3xl bg-white p-10 text-center">
            <p className="text-[15px] font-bold text-muted">
              No phone games yet — more are on the way.
            </p>
          </div>
        </MobileSection>
      ) : (
        rest.length > 0 && (
          <MobileSection title="Games">{grid(rest)}</MobileSection>
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
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-3 pt-6">
      <h2 className="mb-4 text-xl font-black tracking-tight text-zinc-900">
        {title}
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
    <section className="px-3 pt-2 sm:px-8">
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
        className="group relative grid w-full overflow-hidden rounded-3xl bg-brand text-left shadow-xl shadow-brand/20 sm:max-h-[38svh] sm:grid-cols-[1.1fr_1fr]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 85% 20%, rgba(255,199,0,0.25), transparent 50%), radial-gradient(circle at 15% 90%, rgba(255,79,139,0.35), transparent 55%)",
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

/* ===================== Sponsor strips ===================== */
type Ad = {
  logo?: string; // image path
  emoji?: string; // fallback
  text: string;
  href: string;
  cta: string;
  placeholder?: boolean;
};

const FRENCHLY_URL = "https://frenchly.vercel.app";
const FRENCHLY_LOGO = "/ads/frenchly.png";

/**
 * The strip inventory. Only `ADS[0]` is PLACED — the home page carries a single
 * sponsor strip (see {@link FrenchlyAd}). The rest are kept deliberately: entries
 * 1 and 2 are alternate Frenchly copy to rotate in, and entry 3 is the
 * "your ad here" pitch for whenever a second slot is worth selling. They are
 * inventory, not dead code — anything rendering them fires `ad_clicked` through
 * {@link AdStrip} unchanged.
 */
const ADS: Ad[] = [
  {
    logo: FRENCHLY_LOGO,
    text: "Frenchly — snap your GCSE French vocab list, get flashcards instantly.",
    href: FRENCHLY_URL,
    cta: "Try Frenchly",
  },
  {
    logo: FRENCHLY_LOGO,
    text: "You wrote it 3 times and still don't remember? Frenchly fixes that.",
    href: FRENCHLY_URL,
    cta: "Scan vocab",
  },
  {
    logo: FRENCHLY_LOGO,
    text: "GCSE French in 10 minutes a day — Frenchly builds the quiz for you.",
    href: FRENCHLY_URL,
    cta: "Start free",
  },
  {
    emoji: "✨",
    text: "Your ad here — reach thousands of players every day.",
    href: "mailto:smartlizardpy@duck.com?subject=Advertise%20on%20HALLPASS",
    cta: "Get in touch",
    placeholder: true,
  },
];

function AdStrip({ ad }: { ad: Ad }) {
  const isExternal = ad.href.startsWith("http");
  const base =
    "group flex items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition";
  const skin = ad.placeholder
    ? "border-2 border-dashed border-border bg-transparent hover:border-brand hover:bg-brand-50"
    : "border border-border bg-white hover:border-brand-100 hover:bg-brand-50";

  return (
    <a
      href={ad.href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      className={`${base} ${skin}`}
      onClick={() => posthog.capture("ad_clicked", {
        ad_cta: ad.cta,
        ad_href: ad.href,
        is_placeholder: ad.placeholder ?? false,
      })}
    >
      {ad.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ad.logo}
          alt=""
          className="h-6 w-6 shrink-0 object-contain"
        />
      ) : (
        <span className="text-lg">{ad.emoji}</span>
      )}
      <span className="hidden text-[11px] font-black uppercase tracking-wider text-muted sm:inline">
        {ad.placeholder ? "Slot" : "Ad"}
      </span>
      <span className="hidden h-4 w-px bg-border sm:block" />
      <span
        className={`flex-1 truncate text-sm font-bold ${
          ad.placeholder ? "text-muted" : "text-zinc-900"
        }`}
      >
        {ad.text}
      </span>
      <span className="shrink-0 text-sm font-extrabold text-brand group-hover:text-brand-600">
        {ad.cta} →
      </span>
    </a>
  );
}

/** The home page's only sponsor placement — `ADS[0]`, rendered once, mid-page. */
function FrenchlyAd() {
  return (
    <section className="px-3 pt-6 sm:px-8">
      <AdStrip ad={ADS[0]} />
    </section>
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
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-3 pt-[clamp(20px,4svh,40px)] sm:px-8">
      <h2 className="mb-[clamp(12px,2svh,20px)] text-2xl font-black tracking-tight text-zinc-900 sm:text-[28px]">
        {title}
      </h2>
      {children}
    </section>
  );
}
