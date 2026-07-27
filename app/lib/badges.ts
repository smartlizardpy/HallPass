/**
 * HallPass — player badges.
 *
 * DERIVED, NOT STORED, and that is the whole design decision. Every badge below
 * is a pure function of rows that already exist — `player_plays`, `scores`,
 * `game_reviews`, `friendships`, `players.created_at`. Nothing awards a badge,
 * nothing writes one, and there is no table to backfill.
 *
 * The obvious alternative — a `player_badges` table written when a threshold is
 * crossed — costs a new write on the hottest paths (every play, every score,
 * every review), needs a backfill for existing players, and goes stale the moment
 * a review is hidden or a score is deleted by a moderator. Deriving means badges
 * are always exactly true, and adding a new one is a code change rather than a
 * migration plus a backfill job.
 *
 * The cost is a handful of counts per profile view, which is one query.
 *
 * Pure and dependency-free, so it unit-tests in the plain `node` env.
 */

/** Counts a badge decision can be made from. One query fills this. */
export type BadgeStats = {
  /** Distinct games played (rows in `player_plays`). */
  gamesPlayed: number;
  /** Sum of `play_count` across those games. */
  totalPlays: number;
  /** Boards where this player currently holds rank 1. */
  firstPlaces: number;
  /** Distinct boards this player has any score on. */
  boardsEntered: number;
  /** Visible reviews written. */
  reviewsWritten: number;
  /** Most helpful votes any one of their reviews has. */
  bestReviewHelpful: number;
  /** Accepted friendships. */
  friends: number;
  /** Days since the account was created. */
  accountAgeDays: number;
};

export type Badge = {
  id: string;
  label: string;
  /** One line, shown as a tooltip and to screen readers. */
  description: string;
  /** Single emoji. The repo has no icon library and hand-draws its SVGs. */
  icon: string;
  /** Groups the visual treatment; see `BADGE_TONES` in the component. */
  tone: "play" | "score" | "social" | "review" | "time";
};

type BadgeRule = Badge & { earned: (s: BadgeStats) => boolean };

/**
 * Every badge, in the order they should render.
 *
 * Thresholds are deliberately low at the bottom end. These exist to give a new
 * player something on their profile in their first session — a badge wall that
 * stays empty for a month is worse than no badge wall. The rare ones sit at the
 * top so they read as the achievement.
 */
const RULES: BadgeRule[] = [
  {
    id: "champion",
    label: "Champion",
    description: "Holds first place on a leaderboard",
    icon: "👑",
    tone: "score",
    earned: (s) => s.firstPlaces >= 1,
  },
  {
    id: "triple-crown",
    label: "Triple Crown",
    description: "Holds first place on three leaderboards",
    icon: "🏆",
    tone: "score",
    earned: (s) => s.firstPlaces >= 3,
  },
  {
    id: "contender",
    label: "Contender",
    description: "Scored on three different leaderboards",
    icon: "🎯",
    tone: "score",
    earned: (s) => s.boardsEntered >= 3,
  },
  {
    id: "explorer",
    label: "Explorer",
    description: "Played five different games",
    icon: "🧭",
    tone: "play",
    earned: (s) => s.gamesPlayed >= 5,
  },
  {
    id: "completionist",
    label: "Completionist",
    description: "Played twenty different games",
    icon: "🗺️",
    tone: "play",
    earned: (s) => s.gamesPlayed >= 20,
  },
  {
    id: "regular",
    label: "Regular",
    description: "Opened games fifty times",
    icon: "🔥",
    tone: "play",
    earned: (s) => s.totalPlays >= 50,
  },
  {
    id: "critic",
    label: "Critic",
    description: "Wrote three reviews",
    icon: "✍️",
    tone: "review",
    earned: (s) => s.reviewsWritten >= 3,
  },
  {
    id: "trusted-voice",
    label: "Trusted Voice",
    description: "A review of theirs was marked helpful five times",
    icon: "💡",
    tone: "review",
    earned: (s) => s.bestReviewHelpful >= 5,
  },
  {
    id: "friendly",
    label: "Friendly",
    description: "Made five friends",
    icon: "🤝",
    tone: "social",
    earned: (s) => s.friends >= 5,
  },
  {
    id: "veteran",
    label: "Veteran",
    description: "Has been here for ninety days",
    icon: "🎖️",
    tone: "time",
    earned: (s) => s.accountAgeDays >= 90,
  },
];

/** Every badge this player has earned, in display order. */
export function earnedBadges(stats: BadgeStats): Badge[] {
  return RULES.filter((rule) => rule.earned(stats)).map(
    ({ earned: _earned, ...badge }) => badge,
  );
}

/**
 * Badges not yet earned, so a profile can show what is within reach.
 *
 * Shown only to the OWNER. On someone else's profile a list of what they have
 * not achieved is just a list of their shortcomings, which is a strange thing to
 * publish about a child.
 */
export function lockedBadges(stats: BadgeStats): Badge[] {
  return RULES.filter((rule) => !rule.earned(stats)).map(
    ({ earned: _earned, ...badge }) => badge,
  );
}

/** All badges, for a legend. */
export const ALL_BADGES: Badge[] = RULES.map(({ earned: _earned, ...b }) => b);
