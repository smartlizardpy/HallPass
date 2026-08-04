import "server-only";

/**
 * Dashboard "Community" stats — sourced from OUR Neon database, not PostHog.
 *
 * PostHog tells us about anonymous traffic; this is the first-party picture of
 * the leaderboard/player system we built: how many verified players have signed
 * in, how many boards exist, how many scores have been submitted, and who joined
 * most recently. Every read fails soft (returns zeros) so the overview never
 * crashes when the database is unconfigured or briefly unreachable.
 */

import { sql, isMissingColumnError } from "@/app/lib/db";

export type RecentPlayer = {
  name: string;
  image: string | null;
  joinedAt: string;
};

/** A game ranked by how many visible player comments (reviews) it has. */
export type CommentedGame = {
  slug: string;
  count: number;
};

export type CommunityStats = {
  players: number;
  boards: number;
  scores: number;
  /**
   * Total visible player comments (the `game_reviews` model — one per player per
   * game). Zero when the reviews schema is not yet applied; see `getCommentStats`.
   */
  comments: number;
  /** Games with the most visible comments, most first. */
  topCommented: CommentedGame[];
  recentPlayers: RecentPlayer[];
  /** False when the database is unconfigured/unreachable (panel shows a notice). */
  available: boolean;
};

const EMPTY: CommunityStats = {
  players: 0,
  boards: 0,
  scores: 0,
  comments: 0,
  topCommented: [],
  recentPlayers: [],
  available: false,
};

/**
 * Comment (review) analytics, read on their OWN try/catch so a missing reviews
 * schema degrades to zeros WITHOUT taking down the rest of the community panel.
 *
 * Reviews (`008_game_reviews.sql`) may not be applied on a database that predates
 * the feature — migrations here are run by hand. `isMissingColumnError` catches
 * exactly that undefined-table case and returns the zero picture; any other error
 * (a genuine outage) is re-thrown so the caller's own catch marks the panel
 * unavailable rather than silently claiming zero comments.
 *
 * Only `status = 'visible'` rows count: hidden (moderator-removed) and deleted
 * (author-tombstoned) reviews are not live comments and must not inflate a game's
 * tally or the headline total.
 */
async function getCommentStats(): Promise<{
  comments: number;
  topCommented: CommentedGame[];
}> {
  try {
    const [totals, top] = await Promise.all([
      sql`
        SELECT count(*)::int AS comments
        FROM game_reviews
        WHERE status = 'visible'
      `,
      sql`
        SELECT slug, count(*)::int AS n
        FROM game_reviews
        WHERE status = 'visible'
        GROUP BY slug
        ORDER BY n DESC, slug ASC
        LIMIT 8
      `,
    ]);

    return {
      comments: Number(totals[0]?.comments ?? 0),
      topCommented: top.map((r) => ({
        slug: String(r.slug),
        count: Number(r.n ?? 0),
      })),
    };
  } catch (error) {
    if (isMissingColumnError(error)) {
      return { comments: 0, topCommented: [] };
    }
    throw error;
  }
}

export async function getCommunityStats(): Promise<CommunityStats> {
  try {
    const [totals, recent, commentStats] = await Promise.all([
      sql`
        SELECT
          (SELECT count(*) FROM players)::int AS players,
          (SELECT count(*) FROM boards)::int  AS boards,
          (SELECT count(*) FROM scores)::int  AS scores
      `,
      sql`
        SELECT name, image, created_at
        FROM players
        ORDER BY created_at DESC
        LIMIT 8
      `,
      getCommentStats(),
    ]);

    const row = totals[0] ?? {};
    return {
      players: Number(row.players ?? 0),
      boards: Number(row.boards ?? 0),
      scores: Number(row.scores ?? 0),
      comments: commentStats.comments,
      topCommented: commentStats.topCommented,
      recentPlayers: recent.map((r) => ({
        name: (r.name == null ? "" : String(r.name)).trim() || "Player",
        image: r.image == null ? null : String(r.image),
        joinedAt: new Date(r.created_at as string).toISOString(),
      })),
      available: true,
    };
  } catch (error) {
    console.error("Failed to load community stats:", error);
    return EMPTY;
  }
}
