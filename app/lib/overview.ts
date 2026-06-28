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

import { sql } from "@/app/lib/db";

export type RecentPlayer = {
  name: string;
  image: string | null;
  joinedAt: string;
};

export type CommunityStats = {
  players: number;
  boards: number;
  scores: number;
  recentPlayers: RecentPlayer[];
  /** False when the database is unconfigured/unreachable (panel shows a notice). */
  available: boolean;
};

const EMPTY: CommunityStats = {
  players: 0,
  boards: 0,
  scores: 0,
  recentPlayers: [],
  available: false,
};

export async function getCommunityStats(): Promise<CommunityStats> {
  try {
    const [totals, recent] = await Promise.all([
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
    ]);

    const row = totals[0] ?? {};
    return {
      players: Number(row.players ?? 0),
      boards: Number(row.boards ?? 0),
      scores: Number(row.scores ?? 0),
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
