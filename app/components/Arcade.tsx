"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { games as allGames, findGame, type Game } from "../lib/games";
import { GameCard } from "./GameCard";
import { Sidebar } from "./Sidebar";
import { PlayerOverlay } from "./PlayerOverlay";

export function Arcade({
  initialCategory = "All",
  initialPlaying = null,
  playCounts = {},
}: {
  initialCategory?: string;
  initialPlaying?: string | null;
  playCounts?: Record<string, number>;
} = {}) {
  const router = useRouter();
  const [category, setCategoryState] = useState(initialCategory);
  const [query, setQuery] = useState("");
  const [playing, setPlayingState] = useState<string | null>(initialPlaying);

  const setCategory = (cat: string) => {
    posthog.capture("category_selected", { category: cat });
    setCategoryState(cat);
    if (cat === "All") router.push("/");
    else router.push(`/category/${encodeURIComponent(cat.toLowerCase())}`);
  };

  const setPlaying = (slug: string | null) => {
    if (slug) {
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

  const featured = allGames.find((g) => g.isFeatured) ?? allGames[0];
  const playsFor = (g: Game) => playCounts[g.slug] ?? g.plays ?? 0;
  const trending = useMemo(
    () => [...allGames].sort((a, b) => playsFor(b) - playsFor(a)).slice(0, 6),
    [playCounts]
  );
  const newGames = useMemo(() => allGames.filter((g) => g.isNew), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allGames.filter((g) => {
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
  }, [category, query, trending]);

  const playingGame: Game | null = playing ? findGame(playing) ?? null : null;

  return (
    <div className="flex min-h-screen flex-1">
      <Sidebar active={category} onSelect={setCategory} />

      <main className="flex-1 overflow-x-hidden">
        {/* Top bar */}
        <header className="sticky top-0 z-40 flex h-20 items-center gap-4 bg-background/85 px-5 backdrop-blur-xl sm:px-8">
          {/* Mobile logo */}
          <a href="#" className="flex items-baseline gap-0.5 lg:hidden">
            <span className="text-2xl font-black tracking-tight text-brand">
              hallpass
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-accent-yellow" />
          </a>

          {/* Search */}
          <div className="relative flex-1 max-w-2xl">
            <svg
              className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted"
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
              value={query}
              onChange={(e) => {
                const newQuery = e.target.value;
                setQuery(newQuery);
                if (newQuery.length >= 3) {
                  posthog.capture("game_searched", { query: newQuery });
                }
              }}
              placeholder="Search games"
              className="w-full rounded-full bg-white py-3.5 pl-12 pr-5 text-[15px] font-semibold text-zinc-900 placeholder:text-muted outline-none transition focus:ring-4 focus:ring-brand/20"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button className="hidden h-11 w-11 items-center justify-center rounded-full bg-white text-zinc-700 transition hover:text-brand sm:flex">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </button>
            <button className="flex h-11 items-center gap-2 rounded-full bg-brand px-5 text-sm font-extrabold text-white shadow-lg shadow-brand/30 transition hover:bg-brand-600">
              Sign in
            </button>
          </div>
        </header>

        {/* Hero / Featured banner */}
        {category === "All" && !query && (
          <FeaturedBanner game={featured} onPlay={setPlaying} />
        )}

        {/* New row */}
        {category === "All" && !query && newGames.length > 0 && (
          <Section title="New games">
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {newGames.map((g) => (
                <GameCard key={g.slug} game={g} onPlay={setPlaying} />
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
                <GameCard key={g.slug} game={g} onPlay={setPlaying} />
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
                <GameCard key={g.slug} game={g} onPlay={setPlaying} />
              ))}
            </div>
          )}
        </Section>

        {/* Footer ad — "your ad here" slot */}
        {category === "All" && !query && <AdRow index={3} />}

        {/* Footer */}
        <footer className="mt-16 px-5 py-10 sm:px-8">
          <div className="flex flex-col items-start justify-between gap-4 rounded-3xl bg-white p-8 sm:flex-row sm:items-center">
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
    <section className="px-5 pt-2 sm:px-8">
      <button
        type="button"
        onClick={() => {
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
        <div className="relative z-10 flex flex-col justify-center gap-4 p-8 sm:p-12">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-accent-yellow px-3 py-1 text-[11px] font-black uppercase tracking-wider text-zinc-900">
              ★ Featured
            </span>
            <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-white backdrop-blur">
              {game.category}
            </span>
          </div>
          <h2 className="max-w-xl text-4xl font-black leading-[1.05] tracking-tight text-white sm:text-6xl">
            {game.title}
          </h2>
          <p className="max-w-md text-base font-semibold text-white/85 sm:text-lg">
            {game.tagline}
          </p>
          <div className="mt-2 flex items-center gap-4">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-base font-extrabold text-brand shadow-2xl transition group-hover:scale-105">
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/games/${game.slug}/cover.png`}
              alt={game.title}
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
        </div>
      </button>
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
      <span className="text-[11px] font-black uppercase tracking-wider text-muted">
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
    <section className="px-5 pt-6 sm:px-8">
      <AdStrip ad={ADS[0]} />
    </section>
  );
}

function AdRow({ index }: { index: number }) {
  const ad = ADS[index % ADS.length];
  return (
    <section className="px-5 pt-8 sm:px-8">
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
    <section className="px-5 pt-10 sm:px-8">
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
