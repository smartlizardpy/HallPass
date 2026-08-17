import "server-only";

/**
 * HallPass — the CONTENT-HEALTH read.
 *
 * The database half of `content-rules.ts`. Assembles one row per resolved game
 * from the catalogue, the media table, the video table and the review counts,
 * then applies the pure rules.
 *
 * THREE BULK READS, NOT THREE PER GAME. `getAllGameMedia()` and
 * `getAllGameVideos()` already exist and are cached, and reviews are counted in a
 * single grouped query. A per-game loop over 30 games would be 90 round trips to
 * render one panel.
 *
 * EVERY SOURCE FAILS SOFT INDEPENDENTLY, which matters more here than usual: this
 * panel exists to say what is MISSING, so a read that quietly returned nothing
 * would manufacture a to-do list of work already done. `resolveGames()` falls
 * back to the static catalogue; the media and video helpers already return empty
 * maps on failure; the review count is caught here and reported through
 * `reviewsAvailable` so the panel can suppress that one rule rather than accuse
 * every game of having no reviews.
 */

import { sql, isMissingColumnError } from "@/app/lib/db";
import { resolveGames } from "@/app/lib/games-store";
import { getAllGameMedia } from "@/app/lib/game-media";
import { getAllGameVideos } from "@/app/lib/game-videos";
import {
  type GameContent,
  type Issue,
  type IssueId,
  assessGame,
  summarize,
} from "./content-rules";

export type GameHealth = GameContent & { issues: IssueId[] };

export type ContentHealth = {
  games: GameHealth[];
  /** How many games carry each issue, worst-first. */
  summary: { issue: Issue; count: number }[];
  /** Games with no issues at all. */
  healthy: number;
  total: number;
  /**
   * False when the reviews schema could not be read. The panel drops the
   * no-reviews rule instead of reporting every game as having none.
   */
  reviewsAvailable: boolean;
};

/** Visible review counts per slug. Fail-soft, and says whether it worked. */
async function getReviewCounts(): Promise<{
  counts: Map<string, number>;
  available: boolean;
}> {
  try {
    const rows = (await sql`
      SELECT slug, count(*)::int AS n
      FROM game_reviews
      WHERE status = 'visible'
      GROUP BY slug
    `) as { slug: string; n: number }[];
    return { counts: new Map(rows.map((r) => [r.slug, r.n])), available: true };
  } catch (error) {
    // A database predating `008_game_reviews.sql` has no table; anything else is
    // a real outage. Both suppress the rule rather than fake its answer.
    if (!isMissingColumnError(error)) {
      console.error("[growth] getReviewCounts failed", error);
    }
    return { counts: new Map(), available: false };
  }
}

export async function getContentHealth(): Promise<ContentHealth> {
  const [games, media, videos, reviews] = await Promise.all([
    resolveGames(),
    getAllGameMedia(),
    getAllGameVideos(),
    getReviewCounts(),
  ]);

  const assessed = new Map<string, IssueId[]>();
  const rows: GameHealth[] = games.map((game) => {
    const content: GameContent = {
      slug: game.slug,
      title: game.title,
      description: game.description,
      tags: game.tags,
      screenshots: media.get(game.slug)?.length ?? 0,
      hasVideo: videos.has(game.slug),
      // With reviews unreadable, claim one so the rule cannot fire. Suppressing
      // it here keeps `assessGame` honest — it never has to know about outages.
      reviews: reviews.available ? (reviews.counts.get(game.slug) ?? 0) : 1,
    };

    const issues = assessGame(content);
    assessed.set(game.slug, issues);
    return { ...content, issues };
  });

  // Worst pages first — that is the order somebody works down.
  rows.sort((a, b) => b.issues.length - a.issues.length || a.slug.localeCompare(b.slug));

  return {
    games: rows,
    summary: summarize(assessed).filter(
      (s) => reviews.available || s.issue.id !== "no-reviews",
    ),
    healthy: rows.filter((r) => r.issues.length === 0).length,
    total: rows.length,
    reviewsAvailable: reviews.available,
  };
}
