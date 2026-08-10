/**
 * HallPass — challenge tunables and vocabulary.
 *
 * Mirrors `social/config.ts`, `scoreboard/config.ts`, `reviews/config.ts` and
 * `achievements/config.ts`: pure, no `server-only`, no database. Read by the
 * store, the routes AND the client islands, so the limits the UI promises cannot
 * drift from the ones the server enforces.
 *
 * THE ANTI-HARASSMENT DOCTRINE IS INHERITED WHOLESALE FROM `social/config.ts`,
 * and the two rules that matter are worth restating because a challenge is a
 * louder event than a friend request — it can make somebody's phone buzz:
 *
 *  1. EVERYTHING IS KEYED BY `playerId`, NEVER BY HASHED IP. A school NATs its
 *     whole network to one egress address, so an IP-keyed limit tight enough to
 *     stop one griefer takes out a whole computing lab. This is the single most
 *     repeated footgun in this codebase and it is repeated here on purpose.
 *
 *  2. THERE IS NO CAP ON *INBOUND* CHALLENGES. An inbound cap is a denial of
 *     service aimed at the victim: flood someone to the ceiling and their real
 *     friends can no longer reach them. Inbound volume is bounded by limiting
 *     the SENDER instead — a per-sender rate, plus per-pair cooldowns below.
 */

/**
 * The kinds a challenge can be.
 *
 * `seasonal` is the seam for a future site-wide/monthly challenge: it is
 * expressible, CHECK-constrained in `022_challenges.sql`, and DELIBERATELY
 * UNBUILT. Nothing in the app creates one, and `resolve.ts` is written so that
 * when something does, it needs no new branch.
 */
export const CHALLENGE_KINDS = ["friend", "seasonal"] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

/** Narrow an untrusted value to a kind, or `null`. */
export function toChallengeKind(value: unknown): ChallengeKind | null {
  return (CHALLENGE_KINDS as readonly string[]).includes(String(value))
    ? (value as ChallengeKind)
    : null;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Distinct challenges one player may SEND in a rolling window.
 *
 * Twice the friend-request allowance (10/hour) because challenging is the
 * ordinary loop of the feature rather than a one-off act — you challenge the
 * same few friends across several games in a session — while still being a hard
 * ceiling on how much noise one account can generate.
 */
export const CHALLENGE_SENDER_RATE_LIMIT = {
  maxPerWindow: 20,
  windowSeconds: 3600,
} as const;

/** Open, unanswered challenges one player may have in flight at once. */
export const MAX_OPEN_SENT_CHALLENGES = 50;

/**
 * How long before the same challenger may re-send on the same board while the
 * previous challenge is still OPEN.
 *
 * This is the anti-nag limit. Re-sending an open challenge is a poke, not new
 * information, and without a cooldown it is a button that rings someone's phone
 * on demand.
 */
export const CHALLENGE_RESEND_COOLDOWN_SECONDS = 3600;

/**
 * How long before the same challenger may try the same board again after the
 * target DISMISSED it.
 *
 * Longer than the nag cooldown and deliberately equal to
 * `FRIEND_REQUEST_PAIR_COOLDOWN_SECONDS`, because it is the same social event:
 * somebody said no, and the answer to that is not to ask again this afternoon.
 * The row is never deleted, so the cooldown is a column read rather than the
 * separate attempts table friend requests needed.
 */
export const CHALLENGE_DISMISSED_COOLDOWN_SECONDS = 86_400;

/**
 * NO COOLDOWN AFTER A RESOLVED CHALLENGE — this is the rematch, and it is the
 * whole point of the feature. They beat your score, you beat theirs, you send it
 * straight back. A cooldown here would throttle the one loop worth having.
 */
export const CHALLENGE_RESOLVED_COOLDOWN_SECONDS = 0;

/** Rows returned per list. Small: this is an inbox, not an archive. */
export const CHALLENGE_LIST_LIMIT = 50;

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

/**
 * Why a challenge was not created.
 *
 * MIRRORED BY HAND into `sdk/src/contract.ts` as `ChallengeReason`, member for
 * member — the same arrangement `UnlockReason` and `SubmitReason` already have,
 * and for the same reason: the contract file must not import server code. Shaped
 * like those two so a game handles all three surfaces identically.
 *
 * THERE IS DELIBERATELY NO `"blocked"` MEMBER. A block DELETES the friendship
 * row (`007_social_graph.sql` states this, and it is why "friends who play this"
 * needs no block filter), so a blocked pair is never friends and the create
 * path's block gate can only fire behind a `not-friends` that is already true.
 * Reporting it separately would therefore be both unreachable and a disclosure —
 * it would confirm to somebody that a specific person has blocked them, which is
 * exactly what a block is for avoiding. The gate stays; the reason does not.
 */
export const CHALLENGE_REASONS = [
  "no-board", // this game has no leaderboard to challenge on
  "no-score", // the challenger has no score on that board yet
  "not-friends", // not an accepted friend — ALSO what a block reads as
  "self", // you cannot challenge yourself
  "signed-out", // no signed-in player (includes every cross-origin embed)
  "bad-request", // malformed target or board
  "rate-limited", // sender limit, or a pair cooldown, refused it
  "unavailable", // feature not provisioned (schema behind the deploy)
] as const;
export type ChallengeReason = (typeof CHALLENGE_REASONS)[number];

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * The four timestamps that ARE the lifecycle. There is no `status` column: an
 * enum would be a second source of truth for facts these already carry, and
 * `tracker_items_done_at_matches_status` exists precisely because keeping an
 * enum and a timestamp agreeing is a constraint somebody has to write.
 */
export type ChallengeTimestamps = {
  acceptedAt: string | null;
  resolvedAt: string | null;
  dismissedAt: string | null;
};

/** Open = nobody has won it and nobody has thrown it away. */
export function isOpen(c: ChallengeTimestamps): boolean {
  return c.resolvedAt === null && c.dismissedAt === null;
}

/**
 * How long the challenger must wait before re-sending on this board, in seconds.
 *
 * Pure and exported so the store, the route and the tests all read one rule.
 * Ordered most-specific first: a resolved challenge is a rematch and free, a
 * dismissed one owes the long cooldown, and an open one owes the nag cooldown.
 */
export function cooldownSecondsFor(c: ChallengeTimestamps): number {
  if (c.resolvedAt !== null) return CHALLENGE_RESOLVED_COOLDOWN_SECONDS;
  if (c.dismissedAt !== null) return CHALLENGE_DISMISSED_COOLDOWN_SECONDS;
  return CHALLENGE_RESEND_COOLDOWN_SECONDS;
}
