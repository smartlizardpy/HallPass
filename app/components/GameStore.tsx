"use client";

import Link from "next/link";
import posthog from "posthog-js";
import type { Game } from "../lib/games";
import type { GameMedia } from "../lib/game-media-blob";
import { useFavorites } from "../lib/personalization";
import { useOpenGame } from "./ArcadeShell";
import { CoverImage } from "./CoverImage";
import { GameCard } from "./GameCard";
import { FriendsWhoPlay } from "./friends/FriendsWhoPlay";
import { ScreenshotGallery } from "./ScreenshotGallery";

/**
 * A game's store page body — the Steam × Roblox listing that replaced the old
 * `/game/[slug]`, which rendered the whole catalog with the player already open
 * and showed the game's description nowhere.
 *
 * DESIGN NOTE — why this does not look like Steam. Steam is dark and dense; this
 * site is light, and the game `gradient` values were authored for DARK card art
 * (20 of 28 second stops are near-black). Painting a hero with the raw gradient
 * produces a dark-mode island on a `#f4f4f7` page that has no dark variant
 * anywhere. So the "store" feel comes from LAYOUT — a two-column desktop split
 * with a sticky buy-box beside scrolling media — and the game's colour enters
 * only as a ≤18% wash plus a coloured shadow, via `color-mix` in globals.css.
 *
 * Likewise `game.accent` is never used for text. It is card-art accent data: 8 of
 * the 28 values are under 3:1 contrast on white, and an admin can enter any hex
 * for an external game. Raw accent is allowed for washes, shadows and thick
 * rules; anything textual uses the derived `--g-ink`, which mixes in enough
 * foreground to clear 4.5:1 regardless of hue.
 */
export function GameStore({
  game,
  media,
  related,
  plays,
}: {
  game: Game;
  media: GameMedia[];
  related: Game[];
  plays: number;
}) {
  const openGame = useOpenGame();
  const { isFavorite, toggleFavorite } = useFavorites();

  const favorited = isFavorite(game.slug);

  // Same event the catalog cards emit. Without this, favourites recorded from the
  // store page would be invisible in analytics — and the store page is now the
  // destination of every card click, so that is where most of them will happen.
  const handleToggleFavorite = (slug: string) => {
    const target = slug === game.slug ? game : related.find((g) => g.slug === slug);
    posthog.capture(isFavorite(slug) ? "game_unfavorited" : "game_favorited", {
      game_slug: slug,
      game_title: target?.title,
      game_category: target?.category,
    });
    toggleFavorite(slug);
  };
  const categoryHref = `/category/${encodeURIComponent(game.category.toLowerCase())}`;

  return (
    <div className="px-3 pb-8 pt-2 sm:px-8">
      {/* Breadcrumb — mirrors the JSON-LD BreadcrumbList exactly, including the
          category encoding, so the two never disagree. */}
      <nav aria-label="Breadcrumb" className="mb-4 text-[13px] font-bold text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-brand">
              HALLPASS
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href={categoryHref} className="hover:text-brand">
              {game.category}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li className="text-zinc-900">{game.title}</li>
        </ol>
      </nav>

      <section
        className="game-hero relative isolate grid gap-5 overflow-hidden rounded-3xl p-4 sm:gap-6 sm:p-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:p-8"
        style={
          {
            "--g-from": game.gradient[0],
            "--g-to": game.gradient[1],
            "--g-accent": game.accent,
          } as React.CSSProperties
        }
      >
        {/* MEDIA COLUMN. The dark frame here is fine — it is a framed image, not
            the page — which is why the gradient fallback can stay vivid. */}
        <div className="min-w-0">
          {media.length > 0 ? (
            <ScreenshotGallery media={media} title={game.title} />
          ) : (
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-zinc-900">
              <CoverImage
                game={game}
                initialClass="text-7xl sm:text-8xl"
                loading="eager"
                fetchPriority="high"
              />
            </div>
          )}
        </div>

        {/* BUY BOX. Sticky on desktop beside the scrolling media — the store
            idiom that carries the "listing" feel without a dark palette. */}
        <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <h1 className="text-2xl font-black leading-tight tracking-tight text-zinc-900 sm:text-3xl">
            {game.title}
          </h1>
          <p className="mt-2 text-[15px] font-bold text-muted">{game.tagline}</p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <Link
              href={categoryHref}
              className="game-tinted rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wider"
            >
              {game.category}
            </Link>
            {game.tags
              .filter((tag) => tag !== game.category)
              .map((tag) => (
                // Not links: there is no /tag/[tag] route, and /category/<tag>
                // would 404 for any tag that is not also a category.
                <span
                  key={tag}
                  className="rounded-full bg-surface-2 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-muted"
                >
                  {tag}
                </span>
              ))}
          </div>

          <div className="mt-6 flex items-center gap-2">
            <button
              type="button"
              onClick={() => openGame(game.slug)}
              style={{ touchAction: "manipulation" }}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-brand px-6 py-4 text-base font-extrabold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-600 active:scale-[0.98] focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
            >
              <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor">
                <path d="M3 1.5v11l10-5.5z" />
              </svg>
              Play now
            </button>
            <button
              type="button"
              aria-pressed={favorited}
              aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
              onClick={() => handleToggleFavorite(game.slug)}
              style={{ touchAction: "manipulation" }}
              className={`grid h-14 w-14 shrink-0 place-items-center rounded-full border border-border bg-white transition hover:bg-surface-2 active:scale-90 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 ${
                favorited ? "text-accent-pink" : "text-zinc-400"
              }`}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill={favorited ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={favorited ? 0 : 2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none"
              >
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </button>
          </div>

          {/* Per-viewer, so it fetches client-side — see FriendsWhoPlay for why
              this page must never read the session on the server. */}
          <FriendsWhoPlay slug={game.slug} />

          <dl className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white p-4">
              <dt className="text-[11px] font-black uppercase tracking-wider text-muted">
                Plays
              </dt>
              <dd className="mt-1 text-xl font-black text-zinc-900">
                {plays.toLocaleString()}
              </dd>
            </div>
            <div className="rounded-2xl bg-white p-4">
              <dt className="text-[11px] font-black uppercase tracking-wider text-muted">
                Runs in
              </dt>
              <dd className="mt-1 text-xl font-black text-zinc-900">Browser</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ABOUT — the description finally renders somewhere a human can read it.
          `whitespace-pre-line` because the copy is plain text with real line
          breaks; there is no markdown dependency in this repo. */}
      <section className="mt-10">
        <h2 className="text-lg font-black tracking-tight text-zinc-900">
          About this game
        </h2>
        <p className="mt-3 max-w-2xl whitespace-pre-line text-[15px] font-semibold leading-relaxed text-zinc-700">
          {game.description}
        </p>
      </section>

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-5 text-lg font-black tracking-tight text-zinc-900">
            More like this
          </h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {related.map((g) => (
              <GameCard
                key={g.slug}
                game={g}
                onPlay={openGame}
                isFavorite={isFavorite(g.slug)}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
