import {
  categoryShelf,
  resolveCategoryFromSlug,
} from "@/app/lib/categories";
import { resolveCategories, resolveGames } from "@/app/lib/games-store";
import { OG_SIZE } from "@/app/lib/og/brand";
import { listingCard } from "@/app/lib/og/listing-card";
import { getGamePlayCounts } from "@/app/lib/stats";

/**
 * The card a CATEGORY page wears when somebody shares it.
 *
 * A category link is what the growth page's builder mints for "here are the
 * shooters" — the second most-shared shape of URL after the home grid, and until
 * now it inherited the root layout's imageless `openGraph` exactly as `/` did.
 *
 * No `generateStaticParams` here: a metadata route inherits the ones its segment
 * already exports (`page.tsx`), so the cards are prerendered for the same
 * category list the pages are, and adding a second copy would be one more list
 * to keep in step.
 *
 * The shelf is resolved through `categoryShelf` rather than filtered inline, so
 * the card advertises the games the page actually lists — including for `New`
 * and `Trending`, which are not anybody's `game.category` and would otherwise
 * produce a card with no art at all.
 */

export const alt = "Free unblocked games on HALLPASS";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;

  // Every read fails soft: this route must produce SOME card even with no
  // database and no PostHog, because a chat platform caches a failed preview and
  // keeps serving the grey box long after the page is fine.
  const [games, categories, playCounts] = await Promise.all([
    resolveGames().catch(() => []),
    resolveCategories().catch(() => []),
    getGamePlayCounts().catch(() => ({})),
  ]);

  const resolved = resolveCategoryFromSlug(category, categories);
  const shelf = resolved ? categoryShelf(resolved, games, playCounts) : [];

  return listingCard({
    kicker: resolved ? `${resolved} games` : "Unblocked games",
    headline: resolved
      ? `Play ${resolved} unblocked`
      : "The whole arcade, free",
    subhead: shelf.length
      ? `${shelf.length} ${shelf.length === 1 ? "game" : "games"} · no download · no account`
      : "No download · no account · works offline",
    games: shelf,
  });
}
