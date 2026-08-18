import { resolveGames, resolveTags } from "@/app/lib/games-store";
import { OG_SIZE } from "@/app/lib/og/brand";
import { listingCard } from "@/app/lib/og/listing-card";
import { resolveTagFromSlug, tagShelf } from "@/app/lib/tags";

/**
 * The card a TAG page wears when somebody shares it.
 *
 * Same renderer as the home grid's and the categories' — see
 * `app/lib/og/listing-card.tsx` for why all three are one function. Same
 * fail-soft contract too: every read here degrades to a plainer card rather than
 * an error, because a chat platform caches a FAILED preview and keeps serving
 * the grey box long after the page is fine.
 */

export const alt = "Free unblocked games on HALLPASS";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag } = await params;
  const [games, tags] = await Promise.all([
    resolveGames().catch(() => []),
    resolveTags().catch(() => []),
  ]);

  const resolved = resolveTagFromSlug(tag, tags);
  const shelf = resolved ? tagShelf(resolved, games) : [];

  return listingCard({
    kicker: resolved ? `${resolved} games` : "Unblocked games",
    headline: resolved ? `Play ${resolved} unblocked` : "The whole arcade, free",
    subhead: shelf.length
      ? `${shelf.length} ${shelf.length === 1 ? "game" : "games"} · no download · no account`
      : "No download · no account · works offline",
    games: shelf,
  });
}
