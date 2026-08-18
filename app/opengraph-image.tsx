import { resolveGames } from "@/app/lib/games-store";
import { OG_SIZE } from "@/app/lib/og/brand";
import { listingCard } from "@/app/lib/og/listing-card";

/**
 * The card the HOME GRID wears when somebody shares it.
 *
 * `/` is the most-shared URL on the site — it is what the growth page's link
 * builder tags by default, what gets read off a friend's screen, and what ends
 * up pasted into a group chat. Until this file existed it arrived there as a
 * bare grey rectangle: `app/layout.tsx` declares `openGraph` with no `images`
 * key, and there is no static OG asset in `public/`. Every category and tag page
 * inherited the same nothing.
 *
 * The metadata for it is emitted automatically from the exports below — no
 * `openGraph.images` entry in `app/page.tsx` refers to this, and adding one
 * would produce a second, competing tag.
 *
 * `resolveGames()` is the same cached, fail-soft read the page itself uses, so
 * the card lists what the grid lists (external games included in the count) and
 * an unreachable database costs the card its art rather than its existence.
 */

export const alt = "HALLPASS — free unblocked browser games";
export const contentType = "image/png";
export const size = OG_SIZE;

export default async function Image() {
  const games = await resolveGames().catch(() => []);

  // Featured first, so the card is tinted by the same game the grid's hero
  // banner shows — `Arcade` picks it exactly this way.
  const shelf = [...games].sort(
    (a, b) => Number(Boolean(b.isFeatured)) - Number(Boolean(a.isFeatured)),
  );

  return listingCard({
    kicker: "Unblocked games",
    headline: "The whole arcade, free",
    // The count is a real one off the resolved catalogue rather than a number
    // typed here that would go stale the next time a game ships.
    subhead: games.length
      ? `${games.length} games · no download · no account · works offline`
      : "No download · no account · works offline",
    games: shelf,
  });
}
