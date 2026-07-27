/**
 * HallPass — social-graph tunables.
 *
 * Mirrors `app/lib/scoreboard/config.ts`: pure, no `server-only`, read by BOTH
 * the store and the route handlers so the two cannot drift.
 *
 * TWO CHOICES HERE GO AGAINST THE OBVIOUS ANSWER, and both matter enough to
 * state up front:
 *
 * 1. EVERYTHING IS KEYED BY `playerId`, NEVER BY HASHED IP. `hashIp()` in
 *    `scoreboard/guard.ts` is exactly right for anonymous score submission and
 *    would be catastrophic here: a school NATs its entire network to one egress
 *    address, and `clientKeyFromHeaders()` takes the first hop of
 *    `x-forwarded-for`. An IP-keyed friend-request limit tight enough to stop one
 *    griefer would let the first ten pupils in a lab lock out the other four
 *    hundred. This is the kind of limit that looks fine in staging and is
 *    unusable in the room it was built for.
 *
 * 2. THERE IS NO CAP ON *INBOUND* PENDING REQUESTS. An inbound cap is a denial of
 *    service aimed at the victim: flood someone to the ceiling and they can no
 *    longer receive requests from real friends. Inbound volume is bounded
 *    instead by limiting the ATTACKER — a per-requester rate plus a per-pair
 *    cooldown.
 */

/** Distinct targets one player may request in a rolling window. */
export const FRIEND_REQUEST_RATE_LIMIT = {
  maxPerWindow: 10,
  windowSeconds: 3600,
} as const;

/**
 * How long before the same requester may try the same target again.
 *
 * This is what allows a DECLINE to delete the friendship row outright rather than
 * storing a 'declined' status. A stored status would either block re-friending
 * forever (children decline by accident constantly) or need a TTL sweeper that
 * nothing in this repo could run. The cooldown row lives in
 * `friend_request_attempts` and persists independently of the friendship, so the
 * requester still cannot immediately re-send.
 */
export const FRIEND_REQUEST_PAIR_COOLDOWN_SECONDS = 86_400;

/** Outstanding requests one player may have in flight at once. */
export const MAX_OUTSTANDING_REQUESTS = 50;

/**
 * Friends per player. Also a performance guarantee, not just a policy: it hard-
 * bounds the fan-out of the "friends who play this" query.
 */
export const MAX_FRIENDS = 500;

/** Minimum prefix before @-search will return anything — see the enumeration note. */
export const SEARCH_MIN_CHARS = 3;

/**
 * Results per search. Small, and with NO pagination, which is the actual defence:
 * pagination is what would let someone walk the whole namespace.
 */
export const SEARCH_MAX_RESULTS = 10;

/** Cooldown between username changes. */
export const USERNAME_RENAME_COOLDOWN_DAYS = 30;

/**
 * How long a released username is quarantined before anyone else may claim it.
 *
 * Renaming to escape someone is one of the main reasons a person renames, so
 * freeing the old name immediately would hand it straight to them.
 */
export const USERNAME_TOMBSTONE_DAYS = 90;

/** Cooldown between display-handle changes; closes a previously unlimited write. */
export const HANDLE_CHANGE_COOLDOWN_SECONDS = 60;

/** Recency window for "friends who play this" and profile activity. */
export const ACTIVITY_WINDOW_DAYS = 30;

/** Friends shown per game on the store page before "and N more". */
export const FRIENDS_PER_GAME = 5;
