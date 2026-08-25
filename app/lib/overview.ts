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
import { type Delta, delta } from "@/app/lib/insights";

/**
 * The comparison window every `*Delta` on this module is measured over: the last
 * 30 days against the 30 before them, matching the PostHog side of the overview
 * so the two halves of the page are never quietly talking about different
 * periods.
 */
export const WINDOW_DAYS = 30;

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
  /** New players in the last 30 days, against the 30 before them. */
  playersDelta: Delta;
  /** Scores submitted in the last 30 days, against the 30 before them. */
  scoresDelta: Delta;
  /** Players who signed in within the last 7 days. */
  activePlayers7: number;
  /** Players who signed in within the last 30 days. */
  activePlayers30: number;
  /**
   * Players who have come back at least a day after signing up — the honest
   * version of "does anybody stick?", see `getCommunityStats`.
   */
  returningPlayers: number;
  /** Players who have ever put a score on a board. */
  scoringPlayers: number;
  /** Scores carrying a verified player id (the rest are anonymous handles). */
  identifiedScores: number;
  /** Games with the most visible comments, most first. */
  topCommented: CommentedGame[];
  recentPlayers: RecentPlayer[];
  /** False when the database is unconfigured/unreachable (panel shows a notice). */
  available: boolean;
};

const NO_DELTA: Delta = { value: 0, prev: 0, pct: null };

const EMPTY: CommunityStats = {
  players: 0,
  boards: 0,
  scores: 0,
  comments: 0,
  playersDelta: NO_DELTA,
  scoresDelta: NO_DELTA,
  activePlayers7: 0,
  activePlayers30: 0,
  returningPlayers: 0,
  scoringPlayers: 0,
  identifiedScores: 0,
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

/**
 * The whole first-party community picture for the dashboard overview.
 *
 * The headline counts come back in ONE round trip as scalar subqueries rather
 * than a query per number: they are all independent counts over small tables,
 * the Neon HTTP driver bills a network round trip per statement, and they always
 * want to be read as one consistent snapshot anyway.
 *
 * Definitions worth pinning down, because each could plausibly mean something
 * else and the panel labels are short:
 *
 *   ACTIVE is `last_login`, which `upsertPlayerOnLogin` stamps on every sign-in.
 *   It means "came back to the site", not "played" — plays are anonymous and
 *   live in PostHog, and the two must not be blurred.
 *
 *   RETURNING is a login at least a day after the account was made, deliberately
 *   not "more than one login". A player who signs in, plays for an hour and
 *   leaves is one session no matter how many times the session cookie refreshed;
 *   coming back on a LATER day is the thing worth counting.
 *
 *   IDENTIFIED SCORES are rows with a `player_id`. Anonymous handle-only scores
 *   still count on the board — this is the share of the leaderboard that is
 *   attached to a verified person, i.e. how much of the score traffic the sign-in
 *   flow is actually reaching.
 */
export async function getCommunityStats(): Promise<CommunityStats> {
  try {
    const [totals, recent, commentStats] = await Promise.all([
      sql`
        SELECT
          (SELECT count(*) FROM players)::int AS players,
          (SELECT count(*) FROM boards)::int  AS boards,
          (SELECT count(*) FROM scores)::int  AS scores,
          (SELECT count(*) FROM players
             WHERE created_at >= now() - INTERVAL '30 days')::int AS players_now,
          (SELECT count(*) FROM players
             WHERE created_at >= now() - INTERVAL '60 days'
               AND created_at <  now() - INTERVAL '30 days')::int AS players_prev,
          (SELECT count(*) FROM scores
             WHERE created_at >= now() - INTERVAL '30 days')::int AS scores_now,
          (SELECT count(*) FROM scores
             WHERE created_at >= now() - INTERVAL '60 days'
               AND created_at <  now() - INTERVAL '30 days')::int AS scores_prev,
          (SELECT count(*) FROM players
             WHERE last_login >= now() - INTERVAL '7 days')::int AS active_7,
          (SELECT count(*) FROM players
             WHERE last_login >= now() - INTERVAL '30 days')::int AS active_30,
          (SELECT count(*) FROM players
             WHERE last_login > created_at + INTERVAL '1 day')::int AS returning_players,
          (SELECT count(DISTINCT player_id) FROM scores
             WHERE player_id IS NOT NULL)::int AS scoring_players,
          (SELECT count(*) FROM scores
             WHERE player_id IS NOT NULL)::int AS identified_scores
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
    const int = (value: unknown) => Number(value ?? 0) || 0;
    return {
      players: int(row.players),
      boards: int(row.boards),
      scores: int(row.scores),
      comments: commentStats.comments,
      playersDelta: delta(int(row.players_now), int(row.players_prev)),
      scoresDelta: delta(int(row.scores_now), int(row.scores_prev)),
      activePlayers7: int(row.active_7),
      activePlayers30: int(row.active_30),
      returningPlayers: int(row.returning_players),
      scoringPlayers: int(row.scoring_players),
      identifiedScores: int(row.identified_scores),
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
