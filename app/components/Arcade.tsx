"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { type Game } from "../lib/games";
import { useFavorites, useRecentlyPlayed } from "../lib/personalization";
import { CoverImage } from "./CoverImage";
import { ArcadeShell, useOpenGame } from "./ArcadeShell";
import { GameCard } from "./GameCard";

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
  const trending = useMemo(() => {
    const playsFor = (g: Game) => playCounts[g.slug] ?? g.plays ?? 0;
    return [...games].sort((a, b) => playsFor(b) - playsFor(a)).slice(0, 6);
  }, [games, playCounts]);
  const newGames = useMemo(() => games.filter((g) => g.isNew), [games]);

  // Personalized rows, resolved from slugs → games (a slug whose game has since
  // left the catalogue is dropped). Empty until localStorage hydrates post-mount.
  // Plain consts (not useMemo): the maps are tiny and the compiler handles reuse.
  const isGame = (g: Game | undefined): g is Game => Boolean(g);
  const jumpBackIn = recent.map(findGame).filter(isGame);
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

  return (
    <>

        {/* Hero / Featured banner */}
        {category === "All" && !query && (
          <FeaturedBanner game={featured} />
        )}

        {/* Jump back in — recently played (per-device). Appears post-hydration. */}
        {category === "All" && !query && jumpBackIn.length > 0 && (
          <Section title="Jump back in">
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {jumpBackIn.map((g) => (
                <GameCard
                  key={g.slug}
                  game={g}
                  onPlay={openGame}
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
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {favoriteGames.map((g) => (
                <GameCard
                  key={g.slug}
                  game={g}
                  onPlay={openGame}
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
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {newGames.map((g) => (
                <GameCard
                  key={g.slug}
                  game={g}
                  onPlay={openGame}
                  isFavorite={isFavorite(g.slug)}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
          </Section>
        )}

        {/* Sponsor: Frenchly */}
        {category === "All" && !query && <FrenchlyAd />}

        {/* Trending row */}
        {category === "All" && !query && (
          <Section title="Popular this week">
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {trending.slice(0, 6).map((g) => (
                <GameCard
                  key={g.slug}
                  game={g}
                  onPlay={openGame}
                  isFavorite={isFavorite(g.slug)}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
          </Section>
        )}

        {/* Mid-page ad */}
        {category === "All" && !query && <AdRow index={1} />}

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
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {filtered.map((g) => (
                <GameCard
                  key={g.slug}
                  game={g}
                  onPlay={openGame}
                  isFavorite={isFavorite(g.slug)}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
          )}
        </Section>

        {/* Footer ad — "your ad here" slot */}
        {category === "All" && !query && <AdRow index={3} />}

    </>
  );
}

/* ===================== Featured banner ===================== */
function FeaturedBanner({ game }: { game: Game }) {
  return (
    <section className="px-3 pt-2 sm:px-8">
      <Link
        href={`/game/${game.slug}`}
        prefetch={false}
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
        className="group relative grid w-full overflow-hidden rounded-3xl bg-brand text-left shadow-xl shadow-brand/20 sm:grid-cols-[1.1fr_1fr]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 85% 20%, rgba(255,199,0,0.25), transparent 50%), radial-gradient(circle at 15% 90%, rgba(255,79,139,0.35), transparent 55%)",
        }}
      >
        <div className="relative z-10 flex flex-col justify-center gap-3 p-6 sm:gap-4 sm:p-12">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-accent-yellow px-3 py-1 text-[11px] font-black uppercase tracking-wider text-zinc-900">
              ★ Featured
            </span>
            <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-white backdrop-blur">
              {game.category}
            </span>
          </div>
          <h2 className="max-w-xl break-words text-3xl font-black leading-[1.05] tracking-tight text-white sm:text-6xl">
            {game.title}
          </h2>
          <p className="max-w-md text-sm font-semibold text-white/85 sm:text-lg">
            {game.tagline}
          </p>
          <div className="mt-1 flex items-center gap-4 sm:mt-2">
            <span className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-7 py-3.5 text-base font-extrabold text-brand shadow-2xl transition group-hover:scale-105">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M3 1.5v11l10-5.5z" />
              </svg>
              Play now
            </span>
            <span className="hidden text-[13px] font-bold text-white/80 sm:inline">
              {(game.plays ?? 0).toLocaleString()} plays
            </span>
          </div>
        </div>
        <div className="relative hidden h-full min-h-[280px] sm:block">
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

function FrenchlyAd() {
  return (
    <section className="px-3 pt-6 sm:px-8">
      <AdStrip ad={ADS[0]} />
    </section>
  );
}

function AdRow({ index }: { index: number }) {
  const ad = ADS[index % ADS.length];
  return (
    <section className="px-3 pt-8 sm:px-8">
      <AdStrip ad={ad} />
    </section>
  );
}

/* ===================== Section wrapper ===================== */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-3 pt-10 sm:px-8">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-2xl font-black tracking-tight text-zinc-900 sm:text-[28px]">
          {title}
        </h2>
        <button className="hidden text-sm font-extrabold text-brand hover:text-brand-600 sm:block">
          See all →
        </button>
      </div>
      {children}
    </section>
  );
}
