"use client";

import Link from "next/link";
import posthog from "posthog-js";
import type { Game } from "../lib/games";
// TYPE-ONLY, and it has to stay that way: `game-credits.ts` imports
// `server-only`, which throws if it is ever pulled into a client bundle. A
// `import type` is erased before bundling so nothing is emitted, but promoting
// this to a value import would break the build — the same trap `game-media.ts`
// already fell into, which is why its types live in `game-media-blob.ts`.
import type { ResolvedCredit } from "../lib/game-credits";
import type { GameMedia } from "../lib/game-media-blob";
import { useFavorites } from "../lib/personalization";
import { useOpenGame } from "./ArcadeShell";
import { CoverImage } from "./CoverImage";
import { GameCard } from "./GameCard";
import { GameAchievements } from "./GameAchievements";
import { GameReviews } from "./reviews/GameReviews";
import { FriendsWhoPlay } from "./friends/FriendsWhoPlay";
import { ScreenshotGallery } from "./ScreenshotGallery";

/**
 * A game's store page body.
 *
 * LAYOUT is lifted from a Steam-style listing: a title tab above a hero card
 * that splits media (left) from a metadata rail and the Play button (right),
 * then About, then reviews. The SKIN is entirely ours.
 *
 * That distinction is the design brief and worth stating, because the temptation
 * is to copy the chrome too. The reference is dark, boxy and dense; this site is
 * light, rounded and chunky, with no dark variant anywhere in the stylesheet. So
 * what is borrowed is the information architecture — what sits where, and what
 * the eye reaches in what order — while every surface stays white on `#f4f4f7`,
 * corners stay `rounded-3xl`, and the primary action stays brand purple rather
 * than the reference's green.
 *
 * The game's own colour enters only as a ≤18% wash behind the hero and as the
 * title tab's rule (`.game-hero` / `.game-title-tab` in globals.css).
 * `game.accent` is never used for text: 8 of the 28 catalogue values fall below
 * 3:1 contrast on white, and an admin can type any hex for an external game.
 */
export function GameStore({
  game,
  media,
  related,
  plays,
  credit,
}: {
  game: Game;
  media: GameMedia[];
  related: Game[];
  plays: number;
  /**
   * Who made the game and who put it on the site. Either side may be `null` for
   * games that predate the credits table — a missing name is simply omitted
   * rather than filled with a guess, because inventing attribution is worse than
   * having none.
   */
  credit: ResolvedCredit;
}) {
  const openGame = useOpenGame();
  const { isFavorite, toggleFavorite } = useFavorites();

  const favorited = isFavorite(game.slug);
  const categoryHref = `/category/${encodeURIComponent(game.category.toLowerCase())}`;
  const hasShots = media.length > 0;

  const handleToggleFavorite = (slug: string) => {
    const target = slug === game.slug ? game : related.find((g) => g.slug === slug);
    posthog.capture(isFavorite(slug) ? "game_unfavorited" : "game_favorited", {
      game_slug: slug,
      game_title: target?.title,
      game_category: target?.category,
    });
    toggleFavorite(slug);
  };

  const accentVars = {
    "--g-from": game.gradient[0],
    "--g-to": game.gradient[1],
    "--g-accent": game.accent,
  } as React.CSSProperties;

  return (
    <div className="px-3 pb-10 pt-2 sm:px-8" style={accentVars}>
      {/* Breadcrumb — mirrors the JSON-LD BreadcrumbList exactly, encoding
          included, so the two can never disagree. */}
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] font-bold text-muted">
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
        </ol>
      </nav>

      {/* TITLE BAR — the reference's folder-tab header.
          It originally overlapped the hero by 8px as a deliberate "tuck", but
          that read as the title COLLIDING with the card rather than sitting on
          it, so it now stands clear with its own margin. The per-game accent
          appears as a thick left rule (see `.game-title-tab`), which is a use
          `--g-accent` is safe for — unlike text, where 8 of 28 catalogue values
          fall below 3:1 on white. */}
      <div className="game-title-tab mb-3 inline-block max-w-full rounded-2xl bg-white py-3 pl-4 pr-5 shadow-sm">
        <h1 className="truncate text-xl font-black leading-tight tracking-tight text-zinc-900 sm:text-2xl">
          {game.title}
        </h1>
      </div>

      {/* HERO — media left, metadata rail + Play right. */}
      <section className="game-hero grid gap-5 rounded-3xl p-4 sm:gap-6 sm:p-6 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {hasShots ? (
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

        {/* RAIL */}
        <aside className="flex min-w-0 flex-col gap-4">
          {/* Capsule art, only when the gallery already occupies the left side —
              otherwise this would be the same image twice. */}
          {hasShots && (
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-zinc-900">
              <CoverImage game={game} initialClass="text-4xl" />
            </div>
          )}

          <p className="text-[15px] font-bold leading-snug text-zinc-700">
            {game.tagline}
          </p>

          <dl className="divide-y divide-border rounded-2xl bg-white/70 px-4 text-[13px]">
            <MetaRow label="Plays">{plays.toLocaleString()}</MetaRow>
            <MetaRow label="Genre">
              <Link href={categoryHref} className="font-bold text-brand hover:text-brand-600">
                {game.category}
              </Link>
            </MetaRow>
            {game.tags.length > 0 && (
              <MetaRow label="Tags">
                {/* Plain text, not links: there is no /tag/[tag] route, and
                    /category/<tag> would 404 for any tag that is not also a
                    category. */}
                {game.tags.join(", ")}
              </MetaRow>
            )}
            {/*
              Two contributions, two rows — EXCEPT when one person did both, in
              which case repeating the name reads like bureaucracy rather than
              credit. Making the game and bringing it onto HallPass (cover,
              metadata, scoreboard and achievement wiring) are genuinely
              different jobs, and folding them together would take authorship off
              whoever actually wrote it.
            */}
            {credit.author && credit.author === credit.addedBy ? (
              <MetaRow label="By">
                <span className="font-bold text-zinc-900">{credit.author}</span>
              </MetaRow>
            ) : (
              <>
                {credit.author && (
                  <MetaRow label="Created by">
                    <span className="font-bold text-zinc-900">{credit.author}</span>
                  </MetaRow>
                )}
                {credit.addedBy && (
                  <MetaRow label="Added by">
                    <span className="font-bold text-zinc-900">{credit.addedBy}</span>
                  </MetaRow>
                )}
              </>
            )}
            <MetaRow label="Plays in">Your browser</MetaRow>
          </dl>

          <div className="flex items-center gap-2">
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

          <FriendsWhoPlay slug={game.slug} />
        </aside>
      </section>

      {/* ABOUT — its own card, narrower than the hero, as in the reference.
          `whitespace-pre-line` because the copy is plain text with real line
          breaks; there is no markdown dependency in this repo. */}
      <section className="mt-5 max-w-3xl rounded-3xl bg-white p-5 sm:p-6">
        <h2 className="text-[11px] font-black uppercase tracking-wider text-muted">
          About this game
        </h2>
        <p className="mt-3 whitespace-pre-line text-[15px] font-semibold leading-relaxed text-zinc-700">
          {game.description}
        </p>
      </section>

      {/* Renders nothing at all unless this game has achievements provisioned —
          the island decides that itself after fetching, because only the fetch
          knows and 26 of 27 games have none. */}
      <GameAchievements slug={game.slug} />

      <GameReviews slug={game.slug} title={game.title} />

      {related.length > 0 && (
        <section className="mt-10">
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

/** One label/value row in the hero rail's metadata table. */
function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-[11px] font-black uppercase tracking-wider text-muted">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-right font-bold text-zinc-900">
        {children}
      </dd>
    </div>
  );
}
