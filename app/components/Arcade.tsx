"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { type Game } from "../lib/games";
import {
  recordRecentPlay,
  useFavorites,
  useFavoritesServerSync,
  useRecentlyPlayed,
} from "../lib/personalization";
import { GameCard } from "./GameCard";
import { Sidebar } from "./Sidebar";
import { PlayerOverlay } from "./PlayerOverlay";
import { AccountMenu } from "./AccountMenu";
import { WhatsNewLink } from "./WhatsNewLink";

export function Arcade({
  games,
  categories,
  initialCategory = "All",
  initialPlaying = null,
  playCounts = {},
}: {
  games: Game[];
  categories: string[];
  initialCategory?: string;
  initialPlaying?: string | null;
  playCounts?: Record<string, number>;
}) {
  const router = useRouter();
  const [category, setCategoryState] = useState(initialCategory);
  const [query, setQuery] = useState("");
  const [playing, setPlayingState] = useState<string | null>(initialPlaying);
  const [navOpen, setNavOpen] = useState(false);

  const findGame = (slug: string) => games.find((g) => g.slug === slug);

  // Personalization (localStorage-backed, hydrates AFTER mount via
  // useSyncExternalStore — server snapshot is [] so there is no hydration
  // mismatch). Favorites also sync to Neon for a signed-in player.
  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const { recent } = useRecentlyPlayed();
  useFavoritesServerSync();

  // Direct nav to /game/[slug] opens a game without going through setPlaying,
  // so record that entry path here too (covers every way a game opens).
  useEffect(() => {
    if (initialPlaying) recordRecentPlay(initialPlaying);
  }, [initialPlaying]);

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

  const setCategory = (cat: string) => {
    posthog.capture("category_selected", { category: cat });
    setCategoryState(cat);
    if (cat === "All") router.push("/");
    else router.push(`/category/${encodeURIComponent(cat.toLowerCase())}`);
  };

  const setPlaying = (slug: string | null) => {
    if (slug) {
      recordRecentPlay(slug);
      const game = findGame(slug);
      posthog.capture("game_started", {
        game_slug: slug,
        game_title: game?.title,
        game_category: game?.category,
      });
    } else if (playing) {
      const game = findGame(playing);
      posthog.capture("game_closed", {
        game_slug: playing,
        game_title: game?.title,
        game_category: game?.category,
      });
    }
    setPlayingState(slug);
    if (slug) router.push(`/game/${slug}`);
    else if (category !== "All")
      router.push(`/category/${encodeURIComponent(category.toLowerCase())}`);
    else router.push("/");
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

  const playingGame: Game | null = playing ? findGame(playing) ?? null : null;

  return (
    <div className="flex min-h-screen flex-1">
      <Sidebar
        categories={categories}
        active={category}
        onSelect={setCategory}
        mobileOpen={navOpen}
        onMobileClose={() => setNavOpen(false)}
      />

      <main className="flex-1 overflow-x-hidden">
        {/* Top bar */}
        <header
          className="sticky top-0 z-40 flex h-16 items-center gap-2 bg-background/85 px-3 backdrop-blur-xl sm:h-20 sm:gap-4 sm:px-8"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setNavOpen(true)}
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

          {/* Mobile logo */}
          <a href="#" className="flex items-baseline gap-0.5 lg:hidden">
            <span className="text-xl font-black tracking-tight text-brand sm:text-2xl">
              hallpass
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-accent-yellow" />
          </a>

          {/* Search */}
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
              inputMode="search"
              autoComplete="off"
              value={query}
              onChange={(e) => {
                const newQuery = e.target.value;
                setQuery(newQuery);
                if (newQuery.length >= 3) {
                  posthog.capture("game_searched", { query: newQuery });
                }
              }}
              placeholder="Search games"
              aria-label="Search games"
              className="h-11 w-full rounded-full bg-white pl-11 pr-4 text-base font-semibold text-zinc-900 placeholder:text-muted outline-none transition focus:ring-4 focus:ring-brand/20 sm:h-auto sm:py-3.5 sm:pl-12 sm:pr-5 sm:text-[15px]"
            />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <WhatsNewLink />
            <AccountMenu />
          </div>
        </header>

        {/* Hero / Featured banner */}
        {category === "All" && !query && (
          <FeaturedBanner game={featured} onPlay={setPlaying} />
        )}

        {/* Jump back in — recently played (per-device). Appears post-hydration. */}
        {category === "All" && !query && jumpBackIn.length > 0 && (
          <Section title="Jump back in">
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {jumpBackIn.map((g) => (
                <GameCard
                  key={g.slug}
                  game={g}
                  onPlay={setPlaying}
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
                  onPlay={setPlaying}
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
                  onPlay={setPlaying}
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
                  onPlay={setPlaying}
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
                  onPlay={setPlaying}
                  isFavorite={isFavorite(g.slug)}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
          )}
        </Section>

        {/* Footer ad — "your ad here" slot */}
        {category === "All" && !query && <AdRow index={3} />}

        {/* Footer */}
        <footer className="mt-16 px-3 py-10 sm:px-8" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
          <div className="flex flex-col items-start justify-between gap-4 rounded-3xl bg-white p-6 sm:flex-row sm:items-center sm:p-8">
            <div className="flex items-baseline gap-0.5">
              <span className="text-2xl font-black tracking-tight text-brand">
                hallpass
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-accent-yellow" />
            </div>
            <div className="text-[13px] font-bold text-muted sm:text-right">
              <p>
                Games by{" "}
                <span className="text-zinc-900">Ateş Demir</span> · Site by{" "}
                <span className="text-zinc-900">Ozan Kaygusuz</span>
              </p>
              <p className="mt-1 text-muted/80">
                © {new Date().getFullYear()} · all games unblocked, forever.
              </p>
            </div>
          </div>
        </footer>
      </main>

      <PlayerOverlay game={playingGame} onClose={() => setPlaying(null)} />
    </div>
  );
}

/* ===================== Featured banner ===================== */
function FeaturedBanner({
  game,
  onPlay,
}: {
  game: Game;
  onPlay: (slug: string) => void;
}) {
  return (
    <section className="px-3 pt-2 sm:px-8">
      <Link
        href={`/game/${game.slug}`}
        prefetch={false}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          posthog.capture("featured_game_played", {
            game_slug: game.slug,
            game_title: game.title,
            game_category: game.category,
          });
          onPlay(game.slug);
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
            {game.externalUrl && !game.coverUrl ? (
              // External game with no cover art: CSS gradient placeholder
              // (game's gradient stops) instead of a broken <img>.
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{
                  backgroundImage: `linear-gradient(135deg, ${game.gradient[0]}, ${game.gradient[1]})`,
                }}
              >
                <span className="text-6xl font-black text-white/90 drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]">
                  {game.title.charAt(0)}
                </span>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={game.coverUrl ?? `/games/${game.slug}/cover.png`}
                alt={game.title}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
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
