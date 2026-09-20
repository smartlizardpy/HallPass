import type { Game } from "./games";

/**
 * HallPass — how many times a game has been played, and when that number is
 * worth printing.
 *
 * Both of these used to live at the top of `app/components/Arcade.tsx`, which
 * was the right place for exactly as long as the catalogue grid was the only
 * thing that ranked or advertised a play count. It is not any more: the grid's
 * "Most played" ordering and the list layout's per-row count both need the same
 * two answers, and a second copy of either is a second definition that can drift
 * from the first. The docblocks below are the originals, kept because the
 * reasoning in them is what stops somebody re-deriving a different rule.
 */

/**
 * The catalogue's ONE play-count resolution: the live count from
 * `app/lib/stats.ts` first, the static seed in `app/lib/games.ts` second, zero
 * last.
 *
 * Shared rather than written out at each call site so the Trending ranking and
 * the featured banner can never disagree. They used to: the banner read
 * `game.plays` directly, so a game with no seed — the featured one, as it
 * happens — was advertised as "0 plays" while the row beside it ranked on the
 * live number. `app/game/[slug]/page.tsx` resolves its own copy the same way.
 */
export function playsFor(
  game: Game,
  playCounts: Record<string, number>,
): number {
  return playCounts[game.slug] ?? game.plays ?? 0;
}

/**
 * Below this many plays a surface prints no play count at all.
 *
 * The hero is the first copy a new visitor reads, and a genuinely small number
 * there is worse than silence: "3 plays" on the page whose job is to make the
 * arcade look worth staying on tells everyone the arcade is dead. A newly
 * promoted game, or one whose live count has not accumulated yet, therefore
 * drops the line entirely — no placeholder, no "New" substitute, since either
 * would only point at the number that is missing.
 *
 * It is NOT applied to the "Most played" ordering: ranking on a number is a
 * different act from advertising it, and a game with four plays still has to
 * sort somewhere.
 *
 * WORTH KNOWING: nothing on the site currently clears this. The busiest game in
 * the last 30 days had 30 plays when the catalogue toolbar was built, so the
 * banner's play line does not render for any game today. That is the threshold
 * working as intended rather than a bug — but it is also why the list layout
 * carries no play-count column: it would be empty on every row.
 */
export const MIN_PLAYS_SHOWN = 50;
