"use client";

import Link from "next/link";
import posthog from "posthog-js";
import type { Game } from "../lib/games";
import { useFavorites } from "../lib/personalization";
import { tagPath } from "../lib/tags";
import { GameCard } from "./GameCard";
import { useOpenGame } from "./ArcadeShell";
import { PlatformConfirmSheet, usePlayGuard } from "./PlatformGate";

/**
 * A TAG's landing page body — "the local co-op ones", as a page.
 *
 * ── WHY THIS IS NOT `Arcade` WITH A TAG PROP ───────────────────────────────
 * `Arcade` is the catalogue: featured banner, personalised rows, category
 * chips, search, a device-aware mobile shell. All of that is right for a
 * browsing surface and wrong for a page whose entire job is to answer one
 * query someone typed into Google. Threading a second filter axis through its
 * internal state would also mean every future change to the catalogue's state
 * machine has to keep this page's meaning intact.
 *
 * So this is deliberately the SMALL shape: the same `GameCard` grid the store
 * page's "More like this" rail uses, inside the same `ArcadeShell` that page
 * uses. Play still opens the shared overlay, favourites still work, and the
 * device guard still runs — because those come from the shell and the hooks,
 * not from `Arcade`.
 *
 * ── IT RENDERS THE WHOLE SHELF, ON EVERY DEVICE ────────────────────────────
 * No mobile-only membership filtering (`Arcade` reorders rather than drops for
 * exactly this reason: crawlers are mobile clients, and a game dropped on a
 * phone is a game dropped from the index). The device guard still asks before a
 * mismatched game takes over the screen — that is the honest half of the
 * behaviour, and it is preserved.
 */
export function TagListing({
  tag,
  games,
  related,
}: {
  /** The tag as WRITTEN — display copy, already resolved from the URL. */
  tag: string;
  /** Its shelf, in catalogue order. Never empty: the page 404s first. */
  games: Game[];
  /** Other tags that earn a page. The only navigation off this page. */
  related: { tag: string; count: number }[];
}) {
  const openGame = useOpenGame();
  const { requestPlay, pending, confirmPlay, cancelPlay } = usePlayGuard(
    games,
    openGame,
  );
  const { isFavorite, toggleFavorite } = useFavorites();

  // The same capture `Arcade` and `GameStore` make. Without it a heart pressed
  // on this page would be a favourite that happened with no event behind it, and
  // the favourites numbers would quietly under-count by however much traffic
  // these pages bring in — which is the entire reason they exist.
  const handleToggleFavorite = (slug: string) => {
    const willFavorite = !isFavorite(slug);
    const g = games.find((game) => game.slug === slug);
    posthog.capture(willFavorite ? "game_favorited" : "game_unfavorited", {
      game_slug: slug,
      game_title: g?.title,
      game_category: g?.category,
    });
    toggleFavorite(slug);
  };

  return (
    <div className="px-3 pb-10 pt-2 sm:px-8">
      {/* Renders nothing until a device-mismatched ▶ is pressed. */}
      <PlatformConfirmSheet
        game={pending}
        onConfirm={confirmPlay}
        onCancel={cancelPlay}
      />

      {/* Breadcrumb — mirrors the JSON-LD BreadcrumbList on the page exactly,
          as the store page's does, so the two can never disagree. */}
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] font-bold text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-brand">
              HALLPASS
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li className="text-zinc-700">{tag} games</li>
        </ol>
      </nav>

      {/* THE H1 IS VISIBLE HERE, unlike the home grid's and the category page's
          `sr-only` ones. Those sit above a catalogue that names itself; this
          page arrives cold from a search result, and the first line has to
          confirm to a stranger that they landed on the right shelf. */}
      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 sm:text-3xl">
          {tag} Games — Unblocked
        </h1>
        <p className="mt-2 text-[15px] font-semibold leading-relaxed text-zinc-600">
          {games.length === 1
            ? `One ${tag.toLowerCase()} game, free in your browser.`
            : `${games.length} ${tag.toLowerCase()} games, free in your browser.`}{" "}
          No download, no account, and the whole arcade keeps working offline
          once it has loaded.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {games.map((g) => (
          <GameCard
            key={g.slug}
            game={g}
            onPlay={requestPlay}
            isFavorite={isFavorite(g.slug)}
            onToggleFavorite={handleToggleFavorite}
          />
        ))}
      </div>

      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-black tracking-tight text-zinc-900">
            More tags
          </h2>
          <ul className="flex flex-wrap gap-2">
            {related.map((t) => (
              <li key={t.tag}>
                <Link
                  href={tagPath(t.tag)}
                  className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-2 text-sm font-bold text-zinc-700 transition hover:text-brand"
                >
                  {t.tag}
                  <span className="text-muted">{t.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
