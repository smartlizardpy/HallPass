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
 *   - `getServingBlobMap()` — the SHARED cached `games/**` index, mined for the
 *     set of slugs with a custom `games/<slug>/index.html` override. It already
 *     fails soft to an empty map, so a failure just hides the "Custom HTML"
 *     chip. Deliberately not its own lookup: this page needs exactly the data
 *     the serving route already caches.
 *
 * Gated with `requireRole("admin")`, the same guard the per-game actions enforce.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { getServingBlobMap } from "@/app/lib/game-serving-blobs";
import { resolveGames } from "@/app/lib/games-store";
import { store } from "@/app/lib/scoreboard";
import { CoverImage } from "@/app/components/CoverImage";
import type { BoardConfig } from "@/sdk/src/contract";
import { DashHeader } from "../_ui/DashHeader";

type SearchParams = Promise<{ ok?: string | string[]; error?: string | string[] }>;

/** First value of a possibly-repeated query param, or `null`. */
function asString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

export const metadata: Metadata = {
  title: "Games",
  description: "Browse every HALLPASS game and open its control center.",
  robots: { index: false, follow: false },
};

/** Matches a custom game-source blob path → captures its slug. */
const GAME_BLOB_RE = /^games\/([^/]+)\/index\.html$/;

/**
 * The set of slugs that have a custom `games/<slug>/index.html` blob override.
 *
 * Reads the SHARED cached index rather than issuing its own lookup. This page
 * wants exactly the data `getServingBlobMap()` already holds; when that lookup
 * was still a Blob `list()` — a billed "advanced operation" against a Hobby
 * allowance of only 2,000/month — spending one per dashboard page view for a
 * decorative chip was not a good trade, and now that it is a Neon read there is
 * still no reason to ask twice. It also fixes a latent bug: the old direct call
 * took only the FIRST page of results, so past ~1,000 blobs some games would
 * silently lose their "Custom HTML" chip.
 *
 * FAIL-SOFT: `getServingBlobMap()` already degrades to an empty map on any blob
 * error, so the grid just omits the chip rather than erroring.
 */
async function customHtmlSlugs(): Promise<Set<string>> {
  const slugs = new Set<string>();
  for (const pathname of (await getServingBlobMap()).keys()) {
    const match = GAME_BLOB_RE.exec(pathname);
    if (match) slugs.add(match[1]);
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

export default async function GamesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole("admin");

  const sp = await searchParams;
  const ok = asString(sp.ok);
  const error = asString(sp.error);

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
        subtitle="Every game — native and external. Pick one to edit its details, source, and leaderboards."
        action={
          <Link
            href="/dashboard/external-games/new"
            className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Add external game
          </Link>
        }
      />

      {ok && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {ok}
        </div>
      )}
      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

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
              {/* CoverImage, not a hardcoded path: external games have no
                  `/games/<slug>/cover.png` and rendered broken here. */}
              <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-surface-2">
                <CoverImage game={game} initialClass="text-2xl" />
              </div>

              <div className="mt-3 min-w-0">
                <h2 className="truncate text-sm font-black tracking-tight text-foreground group-hover:text-brand">
                  {game.title}
                </h2>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {game.category}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {game.externalUrl && (
                  <Chip className="bg-sky-50 text-sky-700">External ↗</Chip>
                )}
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
                {/* An UNTAGGED game is the state worth surfacing, so this chip
                    marks the absence rather than the value: tagging is a manual
                    pass over the whole catalogue and "which ones are left" should
                    be visible here, not something you hold in your head. Games
                    that ARE tagged say so plainly. */}
                {game.platform ? (
                  <Chip className="border border-border bg-surface-2 text-muted">
                    {game.platform === "both" ? "Desktop + mobile" : `${game.platform} only`}
                  </Chip>
                ) : (
                  <Chip className="bg-amber-50 text-amber-700">No platform</Chip>
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
