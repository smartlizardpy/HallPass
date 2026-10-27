"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { BoardProvider, useBoard } from "./board/BoardProvider";
import type { Game } from "../lib/games";
import { useFavoritesServerSync } from "../lib/personalization";
import { PlayerOverlay } from "./PlayerOverlay";
import { Sidebar } from "./Sidebar";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * The public site chrome — sidebar, sticky header, footer — plus the fullscreen
 * `PlayerOverlay` and the `playing` state that drives it.
 *
 * All of this used to live inside `Arcade`, a 574-line client component that also
 * owned the catalog rows, the featured banner and the filter state. That made it
 * impossible to render "the site chrome around something that is not the catalog"
 * — which is exactly what a game's store page needs. Splitting it here is what
 * unblocks that, and the catalog becomes one more thing rendered as `children`.
 *
 * OPENING A GAME. Any descendant calls {@link useOpenGame} and gets a
 * `(slug) => void`. Passing it down through props would mean threading a callback
 * through every row and card on the catalog page and through unrelated layout on
 * the store page; a context is the smaller change and keeps the overlay's owner
 * in one place. `PlayerOverlay` itself is unchanged and still takes only
 * `{ game, onClose }`.
 *
 * STAYING PRERENDERABLE. This component holds no session state and performs no
 * data fetching. Pages that use it can therefore remain static, which is what
 * keeps them in `prerender-manifest.json` and hence in the service-worker
 * precache built by `scripts/build-sw-manifest.mjs`. Per-viewer data belongs in
 * client islands that fetch from `/api/` (which the service worker never
 * intercepts), the pattern `AccountMenu` already uses.
 */

/**
 * The board's sign-in windows, keyboard, sheets and stylesheet. Loaded only once
 * a board can actually be used here, so a visitor with no board (nearly everyone)
 * downloads none of it.
 */
const BoardLayer = dynamic(() => import("./board/BoardLayer").then((m) => m.BoardLayer), { ssr: false });

/** `null` outside a shell so {@link useOpenGame} can give a useful error. */
const OpenGameContext = createContext<((slug: string) => void) | null>(null);

/**
 * Open a game in the fullscreen player. Throws outside an `ArcadeShell` rather
 * than silently no-op'ing — a Play button that does nothing is a much harder bug
 * to notice than a crash in development.
 */
export function useOpenGame(): (slug: string) => void {
  const open = useContext(OpenGameContext);
  if (!open) {
    throw new Error("useOpenGame must be used inside <ArcadeShell>");
  }
  return open;
}

export function ArcadeShell({ board = false, ...props }: ArcadeShellProps & { board?: boolean }) {
  // Board Mode is opt-in per page. Without it no provider mounts, nothing is
  // fetched, and `ShellBody` sees `useBoard() === null`.
  return board ? (
    <BoardProvider>
      <ShellBody {...props} />
    </BoardProvider>
  ) : (
    <ShellBody {...props} />
  );
}

type ArcadeShellProps = {
  /**
   * The catalog. Two consumers: resolving a slug to the `Game` the overlay
   * renders, and `SiteHeader`, which hands it to "Surprise me" to pick from. Both
   * read the array only — nothing here fetches, so the shell stays prerenderable.
   */
  games: Game[];
  categories: string[];
  /** Highlighted sidebar item. */
  activeCategory?: string;
  /** Omit for sidebar link mode — see `Sidebar`. */
  onSelectCategory?: (category: string) => void;
  /** Supply with `onQueryChange` for live search — see `SiteHeader`. */
  query?: string;
  onQueryChange?: (value: string) => void;
  children: React.ReactNode;
};

function ShellBody({
  games,
  categories,
  activeCategory = "All",
  onSelectCategory,
  query,
  onQueryChange,
  children,
}: ArcadeShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const board = useBoard();
  const [playingSlug, setPlayingSlug] = useState<string | null>(null);

  // Favourites sync lives HERE because the shell is the one component guaranteed
  // to mount exactly once per page. It has no internal guard against being called
  // twice — two calls would mean two GETs and two PUTs to /api/v1/me/favorites —
  // and both the catalog rows and the store body want synced favourites, so
  // calling it in each of them would only be safe for as long as they stay
  // mutually exclusive. Hoisting it removes that coupling entirely.
  useFavoritesServerSync();

  // On a shared board every play goes through "who's playing?" and the board's own
  // overlay, so the score lands on the chosen player. With no board session (the
  // case for everyone else) `interceptPlay` is false and this is unchanged.
  const openGame = useCallback(
    (slug: string) => {
      const game = games.find((g) => g.slug === slug);
      if (game && board?.interceptPlay(game)) return;
      setPlayingSlug(slug);
    },
    [games, board],
  );
  const closeGame = useCallback(() => setPlayingSlug(null), []);

  const playingGame = useMemo(
    () => (playingSlug ? games.find((g) => g.slug === playingSlug) ?? null : null),
    [games, playingSlug],
  );

  return (
    <OpenGameContext.Provider value={openGame}>
      <div className="flex min-h-screen flex-1">
        {/* No `games` here any more: the rail's only use for the catalogue was
            picking a random game for "Surprise me", and that control now lives in
            `SiteHeader`, which takes the array instead. */}
        <Sidebar
          categories={categories}
          active={activeCategory}
          onSelect={onSelectCategory}
          mobileOpen={navOpen}
          onMobileClose={() => setNavOpen(false)}
        />

        {/* `overflow-x-clip`, NOT `overflow-x-hidden`. Per CSS Overflow 3, when
            one axis is `hidden` and the other is `visible`, the visible axis
            computes to `auto` — so `overflow-x-hidden` quietly made this <main>
            a scroll container, and `SiteHeader`'s `sticky top-0` then resolved
            against IT rather than the viewport. <main> never scrolls internally,
            so the header never stuck and scrolled away with the page. `clip`
            clips the same overflow without establishing a scroll container,
            which puts the header's sticky containing block back on the viewport.
            Verified Tailwind v4 emits `overflow-x: clip` for this utility. */}
        <main className="flex-1 overflow-x-clip">
          <SiteHeader
            navOpen={navOpen}
            onOpenNav={() => setNavOpen(true)}
            games={games}
            query={query}
            onQueryChange={onQueryChange}
          />
          {board?.available && <BoardLayer />}
          {children}
          <SiteFooter />
        </main>

        <PlayerOverlay game={playingGame} onClose={closeGame} />
      </div>
    </OpenGameContext.Provider>
  );
}
