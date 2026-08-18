import { resolveGames } from "@/app/lib/games-store";
import { OG_SIZE } from "@/app/lib/og/brand";
import { listingCard } from "@/app/lib/og/listing-card";

/**
 * The card `/new` wears when somebody shares it.
 *
 * It advertises the NEW GAMES rather than the changelog, deliberately: "three
 * new games" is the reason to open a drops link, and the changelog entries
 * themselves live on another origin this card cannot read. A build with no
 * database, or a week with nothing flagged new, falls back to the whole
 * catalogue rather than a card with no art.
 */

export const alt = "What's new on HALLPASS";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  const games = await resolveGames().catch(() => []);
  const fresh = games.filter((g) => g.isNew);
  const shelf = fresh.length > 0 ? fresh : games;

  return listingCard({
    kicker: "What's new",
    headline: fresh.length > 0 ? "Just landed" : "Fresh from the arcade",
    subhead:
      fresh.length > 0
        ? `${fresh.length} new ${fresh.length === 1 ? "game" : "games"} · no download · no account`
        : "New games, fixes and features · no download · no account",
    games: shelf,
  });
}
