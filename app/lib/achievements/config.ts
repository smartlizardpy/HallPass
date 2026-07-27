/**
 * HallPass — achievement tunables.
 *
 * Mirrors `scoreboard/config.ts`, `social/config.ts` and `reviews/config.ts`:
 * pure, no `server-only`, read by both the store and the routes so the two
 * cannot drift.
 */

/**
 * Per-player write limit for unlock/progress calls.
 *
 * Deliberately generous compared with reviews (5 per 10 min). A progress
 * achievement is a BEACON — a game reporting "the player is now at 57 zombies"
 * on a natural cadence — not an act of publishing. Setting this as tightly as a
 * review limit would silently drop legitimate progress updates from a busy game
 * and make counters appear stuck, which is exactly the kind of bug nobody
 * reports because it looks like the game's own fault.
 *
 * PER PLAYER, NEVER PER IP. A school NATs its whole network to one egress
 * address and `clientKeyFromHeaders()` reads the first hop of `x-forwarded-for`,
 * so an IP limit tight enough to matter would take out a whole computing lab.
 * The same note is written into `reviews/config.ts`; it is the single most
 * repeated footgun in this codebase.
 */
export const ACHIEVEMENT_PLAYER_RATE_LIMIT = {
  maxPerWindow: 60,
  windowSeconds: 60,
} as const;

/**
 * Maximum achievements one game may define.
 *
 * A bound on the catalogue rather than on unlocks: the store page renders the
 * full list for a game, so an unbounded catalogue is an unbounded page. 200 is
 * far past what any game here will use and still cheap to render.
 */
export const MAX_ACHIEVEMENTS_PER_GAME = 200;

/**
 * How many unlock/progress entries one SDK call may carry.
 *
 * Batching exists because a game that finishes a level often crosses several
 * thresholds at once, and the alternative is N round trips from inside a
 * requestAnimationFrame loop. Capped so one call cannot become a write
 * amplifier.
 */
export const MAX_BATCH_SIZE = 20;

/** Why an unlock did not land. Mirrors `SubmitReason` in the SDK contract. */
export type UnlockReason =
  /** No game slug configured or passed. */
  | "no-game"
  /** The key was missing, malformed, or the batch was empty/oversized. */
  | "bad-request"
  /** No signed-in player — achievements are inherently identity-bound. */
  | "signed-out"
  /** No achievement with that key is provisioned for this game. */
  | "unknown-achievement"
  /** The client is inert (sandboxed preview, no network/storage). */
  | "inert"
  /** The request never reached the server. */
  | "network"
  /** Server rejected with 429. */
  | "rate-limited"
  /** Server returned another non-2xx. */
  | "http";

/**
 * Key format, mirrored from the `achievements_key_format` CHECK constraint in
 * `009_achievements.sql`. Kept in lockstep by hand: validating here turns a
 * constraint violation (a 503 the player sees as "something broke") into a clean
 * `bad-request` the game can log.
 */
export const ACHIEVEMENT_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isAchievementKey(value: unknown): value is string {
  return typeof value === "string" && ACHIEVEMENT_KEY_RE.test(value);
}
