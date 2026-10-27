/**
 * BoardPass — tunable limits, in one place.
 *
 * Every number the feature's behaviour hangs on lives here so a reviewer can read
 * the whole policy at once and a test can import the same values the code uses.
 * Durations are in SECONDS unless the name says otherwise.
 *
 * The cookie is `hp_boardpass`: 32 random bytes in the browser, only their SHA-256
 * in the database (see `token.ts`).
 */

/** Rollout switch stored in `app_settings`; see `flag.ts`. */
export const BOARDPASS_MODE_KEY = "boardpass:mode";
export const BOARDPASS_MODES = ["off", "staff", "on"] as const;
export type BoardPassMode = (typeof BOARDPASS_MODES)[number];

/** Most players on one board at once. Mirrored by a CHECK in the schema. */
export const MAX_PARTICIPANTS = 8;

/** A lobby that nobody touches for this long is ended. */
export const LOBBY_IDLE_SECONDS = 5 * 60;
/** The "Still playing?" bar shows this long before idle expiry. */
export const IDLE_WARNING_SECONDS = 60;
/** While a game is open, idle runs out this long after launch or the last score. */
export const GAME_IDLE_SECONDS = 20 * 60;
/** Hard cap on a board session. "Keep Playing" can never pass it. */
export const ABSOLUTE_SECONDS = 45 * 60;
/**
 * A gameplay write (score, achievement) is still accepted this long after idle
 * expiry so a game-over score is not lost. Roster, login and `/me` get no grace.
 */
export const GAMEPLAY_GRACE_SECONDS = 2 * 60;

/** A PIN change needs a Google sign-in at most this old. */
export const RECENT_AUTH_SECONDS = 10 * 60;

export const PIN_LENGTH = 6;

/**
 * Argon2id. m is in KiB. Starting values; benchmark on the deployment runtime
 * before raising them. They are written into every stored hash, so a later bump
 * only affects new hashes.
 */
export const ARGON2 = { memory: 65536, passes: 3, parallelism: 1, tagLength: 32 } as const;
export const HASH_VERSION = 1;

/** Failures before the account locks, and how the lock grows. */
export const ACCOUNT_LOCK_AFTER = 5;
export const ACCOUNT_LOCK_BASE_SECONDS = 30;
export const ACCOUNT_LOCK_MAX_SECONDS = 15 * 60;
/** A quiet account forgets its failures after this long. */
export const ACCOUNT_FAILURE_DECAY_SECONDS = 24 * 60 * 60;

/**
 * Network-level caps per attempt window. The IP-only cap is generous on purpose:
 * a whole school can share one public address, and one student must not be able
 * to lock out the class. The per-(IP, username) cap is the tight one.
 */
export const ATTEMPT_WINDOW_SECONDS = 10 * 60;
export const ATTEMPTS_PER_IP = 300;
export const ATTEMPTS_PER_IP_USERNAME = 10;

/** Rows older than this are deleted opportunistically on login. */
export const CLEANUP_AFTER_SECONDS = 24 * 60 * 60;
