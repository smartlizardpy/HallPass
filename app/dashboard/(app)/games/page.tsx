/**
 * HallPass dashboard — games index, as a CARD GRID.
 *
 * This replaces the old dropdown-driven HTML editor (which crammed every game
 * into three shared `<select>` forms) with a game-CENTRIC browser: one polished
 * card per game, each linking to its own control center
 * (`/dashboard/games/<slug>`) where source, details, and leaderboards are edited
 * in context.
 *
 * Three reads feed the cards, every one of them FAIL-SOFT so the grid renders
 * even when a dependency is down:
 *   - `resolveGames()` — the override-applied catalogue (already fails soft to
 *     the static list on a Neon outage).
 *   - `store.listBoards()` — grouped by `gameSlug` into a per-game board count;
 *     `.catch(() => [])` so an unconfigured/unreachable database simply shows
 *     "0 boards" rather than throwing.
 *   - one `list({ prefix: "games/" })` against Vercel Blob — the set of slugs
 *     with a custom `games/<slug>/index.html` override; wrapped in try/catch so a
 *     blob failure just hides the "Custom HTML" chip.
 *
 * Gated with `requireRole("admin")`, the same guard the per-game actions enforce.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { list } from "@vercel/blob";
import { requireRole } from "@/app/lib/auth";
import { resolveGames } from "@/app/lib/games-store";
import { store } from "@/app/lib/scoreboard";
import type { BoardConfig } from "@/sdk/src/contract";
import { DashHeader } from "../_ui/DashHeader";

export const metadata: Metadata = {
  title: "Games",
  description: "Browse every HALLPASS game and open its control center.",
  robots: { index: false, follow: false },
};

/** Matches a custom game-source blob path → captures its slug. */
const GAME_BLOB_RE = /^games\/([^/]+)\/index\.html$/;

/**
 * The set of slugs that have a custom `games/<slug>/index.html` blob override.
 * FAIL-SOFT: any blob error (unconfigured token, network) yields an empty set,
 * so the grid just omits the "Custom HTML" chip rather than erroring.
 */
async function customHtmlSlugs(): Promise<Set<string>> {
  const slugs = new Set<string>();
  try {
    const { blobs } = await list({ prefix: "games/" });
    for (const blob of blobs) {
      const match = GAME_BLOB_RE.exec(blob.pathname);
      if (match) slugs.add(match[1]);
    }
  } catch {
    // No blob access → no custom-HTML chips; the grid still renders.
  }
  return slugs;
}

/** A small status pill rendered on each game card. */
function Chip({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-bold ${className}`}
    >
      {children}
    </span>
  );
}

export default async function GamesPage() {
  await requireRole("admin");

  // resolveGames already fails soft; the board list is guarded so an
  // unconfigured/unreachable Neon shows "0 boards" instead of throwing.
  const [games, boards, customSlugs] = await Promise.all([
    resolveGames(),
    store.listBoards().catch(() => [] as BoardConfig[]),
    customHtmlSlugs(),
  ]);

  // Group board counts by the game each board is linked to.
  const boardCounts = new Map<string, number>();
  for (const board of boards) {
    if (board.gameSlug) {
      boardCounts.set(board.gameSlug, (boardCounts.get(board.gameSlug) ?? 0) + 1);
    }
  }

  return (
    <>
      <DashHeader
        title="Games"
        subtitle="Pick a game to edit its details, source code, and leaderboards."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((game) => {
          const boardCount = boardCounts.get(game.slug) ?? 0;
          const hasCustom = customSlugs.has(game.slug);
          return (
            <Link
              key={game.slug}
              href={`/dashboard/games/${game.slug}`}
              className="group flex flex-col rounded-xl border border-border bg-surface p-3 transition hover:border-brand/40 hover:shadow-sm"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/games/${game.slug}/cover.png`}
                alt=""
                loading="lazy"
                className="aspect-video w-full rounded-lg bg-surface-2 object-cover"
              />

              <div className="mt-3 min-w-0">
                <h2 className="truncate text-sm font-black tracking-tight text-foreground group-hover:text-brand">
                  {game.title}
                </h2>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {game.category}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {game.isNew && (
                  <Chip className="bg-emerald-50 text-emerald-700">New</Chip>
                )}
                {game.isFeatured && (
                  <Chip className="bg-brand-50 text-brand">Featured</Chip>
                )}
                {hasCustom && (
                  <Chip className="border border-border bg-surface-2 text-muted">
                    Custom HTML
                  </Chip>
                )}
                <Chip
                  className={
                    boardCount > 0
                      ? "bg-brand-50 text-brand"
                      : "bg-surface-2 text-muted"
                  }
                >
                  {boardCount} board{boardCount === 1 ? "" : "s"}
                </Chip>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
