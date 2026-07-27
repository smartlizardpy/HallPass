/**
 * HallPass Scoreboard SDK — shared wire & API contract.
 *
 * SINGLE SOURCE OF TRUTH for every type that crosses the network boundary
 * between the browser SDK (`sdk/src/*`) and the server (`app/lib/scoreboard/*`,
 * `app/api/v1/*`). It is also the public type surface of the eventual npm
 * package, so treat it as the SDK's API.
 *
 * Rules that keep this file safe to share both ways:
 *  - TYPES ONLY. No runtime values, no imports, no side effects. The server
 *    imports it with `import type { ... }`, so nothing here is ever bundled
 *    into a route, and the browser build erases it entirely.
 *  - Within SDK major v1 this file is APPEND-ONLY: you may add optional fields
 *    or new types, but never remove, rename, or repurpose an existing one.
 *    A breaking change means a new `/sdk/v2/` + `/api/v2/` contract.
 */

/** Sort direction for a board. `desc` = higher score wins (default); `asc` = lower wins (time / golf). */
export type SortDir = "desc" | "asc";

/** Leaderboard window. `day` / `week` filter by `created_at`; `all` is unbounded. */
export type Period = "all" | "day" | "week";

/**
 * Runtime state of the client global.
 *  - `loading` — the real SDK has not initialised yet.
 *  - `live`    — networking is available; calls hit the API.
 *  - `inert`   — networking/storage is unavailable (e.g. a sandboxed preview);
 *                every call still resolves with a safe no-op and never throws.
 */
export type Mode = "loading" | "live" | "inert";

/** One ranked entry as returned by the public API and surfaced to games. */
export interface ScoreEntry {
  rank: number;
  handle: string;
  score: number;
  /**
   * Whether this entry is tied to a verified player (a signed-in Google
   * identity) rather than an anonymous handle submission. When `true`, `handle`
   * carries the player's effective display name (their chosen handle, else their
   * Google name). Absent/`false` for anonymous entries. Added in v1 (append-only).
   */
  verified?: boolean;
  /**
   * The verified player's avatar URL, when one exists. `null`/absent for
   * anonymous entries (and for verified players with no avatar). EMAIL is never
   * exposed here or anywhere else. Added in v1 (append-only).
   */
  avatar?: string | null;
}

// ---- Wire types: public leaderboard endpoint --------------------------------

/** `GET /api/v1/leaderboard/<game>` success body. */
export interface LeaderboardResponse {
  game: string;
  title: string;
  scoreLabel: string;
  sort: SortDir;
  period: Period;
  scores: ScoreEntry[];
}

/** `POST /api/v1/leaderboard/<game>` request body. */
export interface SubmitRequest {
  score: number;
  handle?: string;
}

/** `POST /api/v1/leaderboard/<game>` success body. */
export interface SubmitResponse {
  ok: true;
  rank: number;
  handle: string;
  score: number;
  /**
   * Short-lived token an anonymous submission can later present to `POST
   * /api/v1/me/claim` to attach the score to a signed-in player. Absent when the
   * submission was already tied to a session (or claiming is disabled
   * server-side). Added in v1 (append-only).
   */
  claimToken?: string;
}

// ---- Wire types: player identity --------------------------------------------

/**
 * The PUBLIC, email-free projection of a signed-in player. `name` and `handle`
 * both carry the effective display name (chosen handle, else Google name) so a
 * consumer can use either without re-deriving it. EMAIL is never part of this
 * shape. Added in v1 (append-only).
 */
export interface PlayerIdentity {
  id: string;
  name: string;
  image: string | null;
  handle: string;
}

/**
 * `GET /api/v1/me` success body: the current player's identity, or `null` when
 * there is no session (anonymous / cross-origin with no cookie). Added in v1.
 */
export interface MeResponse {
  player: PlayerIdentity | null;
  /**
   * Whether the signed-in user holds a dashboard role (admin/super_admin), so a
   * header/menu can show a Dashboard link. Never leaks email. Added in v1.
   */
  isAdmin?: boolean;
  /**
   * The user's own dashboard role ("super_admin" | "admin"), or null for a plain
   * player — lets a header show the precise role label. Added in v1.
   */
  role?: "super_admin" | "admin" | null;
}

/** Request body to set the current player's chosen handle. Added in v1. */
export interface SetHandleRequest {
  handle: string;
}

/**
 * `POST /api/v1/me/claim` request body: the claim tokens (from earlier anonymous
 * `SubmitResponse.claimToken`s) to attach to the current signed-in player. Added
 * in v1 (append-only).
 */
export interface ClaimRequest {
  tokens: string[];
}

/**
 * `POST /api/v1/me/claim` success body: how many of the presented tokens were
 * successfully claimed for the current player. Added in v1 (append-only).
 */
export interface ClaimResponse {
  ok: true;
  claimed: number;
}

// ---- Wire types: admin board provisioning -----------------------------------

/** `POST /api/v1/admin/boards` request body (admin-gated). */
export interface CreateBoardRequest {
  /** The board's own identity. Free-form slug; need not name a game. */
  slug: string;
  title: string;
  sort?: SortDir;
  scoreLabel?: string;
  maxScore?: number | null;
  /**
   * Optional game to link this board to. When provided it must name a known
   * game. When omitted, the board is standalone — except the admin route
   * defaults it to `slug` when `slug` itself names a known game, preserving the
   * legacy "provision a game's board" behaviour. Added in v1 (append-only).
   */
  gameSlug?: string | null;
}

/** Board configuration as stored and echoed back to callers. */
export interface BoardConfig {
  /**
   * The board's own identity (used as the `/api/v1/leaderboard/<id>` path).
   * Historically this equalled a game slug; with boards decoupled from games it
   * is the board's free-form id. Existing boards keep id == old game slug, so
   * this field is backward-compatible.
   */
  slug: string;
  title: string;
  sort: SortDir;
  scoreLabel: string;
  maxScore: number | null;
  /**
   * Optional link to a game in the static games list. `null`/absent means the
   * board is standalone (not yet attached to a game). Added in v1 (append-only).
   */
  gameSlug?: string | null;
}

/** `POST /api/v1/admin/boards` success body. */
export interface CreateBoardResponse {
  ok: true;
  created: boolean;
  board: BoardConfig;
}

/** Uniform error body returned by every endpoint on a non-2xx response. */
export interface ApiError {
  error: string;
}

// ---- Wire types: achievements -----------------------------------------------
//
// NAME COLLISION, ON PURPOSE: `PlayerAchievement` and `UnlockReason` below are
// structurally identical to the ones in `app/lib/achievements/store.ts` and
// `app/lib/achievements/config.ts`. They are re-declared here rather than
// imported because THIS file is the browser's type surface and must stay
// import-free (see the header) — the SDK build erases it entirely, and pulling a
// server module in for a type would drag `server-only` into the bundle. A module
// that imports both must alias one of them.

/**
 * One entry in an unlock/progress batch.
 *
 * `progress` is ABSOLUTE, never a delta — "the player is now at 57", never
 * "add 3". That is what makes a retried or out-of-order beacon harmless: the
 * server takes `GREATEST(stored, incoming)`, so a duplicate can neither
 * double-count nor walk a counter backwards. OMITTING it (or `null`) means
 * "reach the target", i.e. earn the thing outright. Added in v1 (append-only).
 */
export interface AchievementEntryRequest {
  key: string;
  progress?: number | null;
}

/**
 * `POST /api/v1/games/<slug>/achievements` request body. Always a batch, even
 * for one key: a game that finishes a level crosses several thresholds at once,
 * and the alternative is N round trips out of a game loop. Capped server-side at
 * 20 entries. Added in v1 (append-only).
 */
export interface UnlockRequest {
  entries: AchievementEntryRequest[];
}

/**
 * Per-entry outcome echoed by the server, one per RESOLVED entry (an unknown key
 * simply produces no element — it is not an error). Added in v1 (append-only).
 */
export interface UnlockEntryResult {
  key: string;
  /**
   * NEWLY earned by THIS call. The toast signal: true only when the achievement
   * was unearned before the statement ran and earned after it. An already-held
   * achievement reports `false` here and `true` in `alreadyUnlocked`.
   */
  unlocked: boolean;
  alreadyUnlocked: boolean;
  /** Absolute progress after the write. */
  progress: number;
  target: number;
  /**
   * Presentation fields, OPTIONAL by design. When the server enriches a result
   * from the catalogue the SDK can fire the `"achievement"` event immediately;
   * when it does not, the SDK fills them from its own catalogue read, so a game
   * never has to care which happened. A server MUST NOT send `name` for an
   * achievement the player has not earned (an unearned secret's name is the
   * secret). Added in v1 (append-only).
   */
  name?: string;
  description?: string;
  icon?: string;
  points?: number;
}

/** `POST /api/v1/games/<slug>/achievements` success body. Added in v1 (append-only). */
export interface UnlockResponse {
  /**
   * Batch-level outcome. Note `ok: true` WITH `reason: "unknown-achievement"` is
   * a real and deliberate combination: a game that ships a key before an admin
   * provisions it is a developer diagnostic, not a player-facing failure.
   */
  ok: boolean;
  reason?: UnlockReason;
  results: UnlockEntryResult[];
}

/**
 * One achievement as seen BY a player — the browser-facing projection.
 *
 * Deliberately has no numeric id: `key` is the only identifier a game or client
 * ever needs, and keeping the primary key out means no client surface can grow a
 * dependency on it. An unearned SECRET arrives redacted (`name` becomes a
 * placeholder, `description` empty) — the redaction happens server-side, so this
 * type is what it is safe to render. Added in v1 (append-only).
 */
export interface PlayerAchievement {
  key: string;
  name: string;
  description: string;
  icon: string;
  points: number;
  /** `> 1` makes this a progress achievement; `1` is a plain unlock. */
  target: number;
  secret: boolean;
  /** Absolute, clamped to `target` so a progress bar cannot overfill. */
  progress: number;
  unlocked: boolean;
  unlockedAt: string | null;
}

/** `GET /api/v1/games/<slug>/achievements` success body. Added in v1 (append-only). */
export interface AchievementsResponse {
  game: string;
  achievements: PlayerAchievement[];
  /** Points the viewing player has earned in this game. */
  earnedPoints: number;
  /** Points available in this game. */
  totalPoints: number;
  /** `false` when the feature is not provisioned/reachable; the SDK reads `[]`. */
  enabled?: boolean;
}

// ---- Client SDK surface (window.HallPass) -----------------------------------

/** Why a `submitScore` call did not land. */
export type SubmitReason =
  | "no-game" // no game slug configured / passed
  | "bad-score" // score was not a finite number in range
  | "inert" // client is inert (sandboxed / no network)
  | "network" // request failed to reach the server
  | "rate-limited" // server rejected with 429
  | "http"; // server returned another non-2xx status

/** Result of `submitScore`. Always resolved — never rejected. */
export interface SubmitResult {
  ok: boolean;
  rank?: number;
  error?: string;
  reason?: SubmitReason;
}

export interface SubmitOptions {
  /** Override the stored handle for this submission only. */
  handle?: string;
  /** When no handle is stored, prompt the player once for initials. Default `true`. */
  promptHandle?: boolean;
}

export interface GetScoresOptions {
  /** 1..100, default 10. */
  limit?: number;
  /** Default `"all"`. */
  period?: Period;
  /** Override the configured game slug. */
  game?: string;
}

export interface ReadyState {
  ready: boolean;
  game: string | null;
  handle: string | null;
  mode: Mode;
}

/**
 * `"achievement"` is a NEW EVENT NAME, which the append-only rule explicitly
 * allows (a game that never listens for it is unaffected). It fires ONCE per
 * achievement, at the moment it is newly earned, and NEVER for one the player
 * already held — see {@link AchievementUnlock}. Added in v1 (append-only).
 */
export type EventName =
  | "ready"
  | "scores"
  | "submitted"
  | "error"
  | "auth"
  | "achievement";

/**
 * Payload for the `"auth"` event: fired when the signed-in player changes. Carries
 * the new PUBLIC identity, or `null` when the player signed out. Added in v1
 * (append-only).
 */
export interface AuthChangePayload {
  player: PlayerIdentity | null;
}

/**
 * Options for the same-origin auth redirects (`signIn` / `signOut`). Added in v1
 * (append-only).
 */
export interface AuthRedirectOptions {
  /**
   * Where to send the browser back to once the auth flow completes. Defaults to
   * the current `location.href`; forwarded to the `/play/*` page as `callbackUrl`.
   */
  redirectTo?: string;
}

/**
 * Why an `unlock` / `unlockMany` / `progress` call did not land.
 *
 * Mirrors `UnlockReason` in `app/lib/achievements/config.ts` member for member —
 * the two are kept in lockstep BY HAND for the same reason the wire types above
 * are re-declared: this file must not import server code. Shaped like
 * {@link SubmitReason} so a game handles both surfaces the same way. Added in v1
 * (append-only).
 */
export type UnlockReason =
  | "no-game" // no game slug configured / passed
  | "bad-request" // key missing/malformed, or the batch was empty/oversized
  | "signed-out" // no signed-in player (includes every cross-origin embed)
  | "unknown-achievement" // no achievement with that key is provisioned here
  | "inert" // client is inert (sandboxed / no network)
  | "network" // request failed to reach the server
  | "rate-limited" // server rejected with 429
  | "http"; // server returned another non-2xx status

/**
 * Payload of the `"achievement"` event, and of `UnlockResult.achievement`: an
 * achievement the player JUST earned.
 *
 * Every field is REQUIRED and non-null so a toast can render straight from it —
 * `showToast(a.name, a.icon)` must never print `undefined`. When the server does
 * not enrich the unlock, the SDK fills these in from the catalogue; if even that
 * fails it falls back to the key as the name and a generic medal as the icon.
 * Added in v1 (append-only).
 */
export interface AchievementUnlock {
  key: string;
  name: string;
  description: string;
  icon: string;
  points: number;
  /** Absolute progress after the unlock (equals `target` for a plain unlock). */
  progress: number;
  target: number;
  /** ISO timestamp, when the server reported one. */
  unlockedAt: string | null;
  /** The game slug the achievement belongs to. */
  game: string | null;
}

/**
 * Result of `unlock` / `progress` (and one element of `unlockMany`'s array).
 * Always resolved — never rejected.
 *
 * Shaped exactly like {@link SubmitResult}: `ok` is the only guaranteed field,
 * because the pre-load inline stub's 2s inert fallback can only produce
 * `{ ok: false, reason: "inert" }` and lying about the rest would be worse than
 * omitting it. The live client always populates `key`, `unlocked`, `progress`
 * and `target`. Added in v1 (append-only).
 */
export interface UnlockResult {
  ok: boolean;
  /** Echoed back so a batch result can be attributed without positional matching. */
  key?: string;
  /** NEWLY earned by THIS call — the toast signal. Never true for a re-unlock. */
  unlocked?: boolean;
  /** Held before this call. `unlocked` and `alreadyUnlocked` are never both true. */
  alreadyUnlocked?: boolean;
  progress?: number;
  target?: number;
  /** Present IFF `unlocked` — the same payload the `"achievement"` event carries. */
  achievement?: AchievementUnlock;
  error?: string;
  reason?: UnlockReason;
}

/** Options for `unlock` / `unlockMany`. Added in v1 (append-only). */
export interface UnlockOptions {
  /** Override the configured game slug. */
  game?: string;
}

/** Options for `progress`. Added in v1 (append-only). */
export interface ProgressOptions {
  /** Override the configured game slug. */
  game?: string;
  /**
   * Send immediately instead of waiting out the ~1s coalescing window. Use it
   * for the LAST value of a run (game over), where a player who finishes at
   * 100/100 must never be left looking at 97/100.
   */
  flush?: boolean;
}

/** Options for `getAchievements`. Added in v1 (append-only). */
export interface GetAchievementsOptions {
  /** Override the configured game slug. */
  game?: string;
}

/**
 * The global the SDK installs at `window.HallPass` (aliased `window.HP`).
 *
 * Golden rule: every method RESOLVES and NONE THROW. In an environment with no
 * network or storage the methods resolve to safe no-ops (`getScores → []`,
 * `submitScore → { ok: false, reason: "inert" }`) so a game embedding the SDK
 * can never be broken by it.
 */
export interface HallPass {
  /** SDK major version, e.g. `"1"` — matches the `/sdk/v1/` URL contract. */
  readonly version: string;
  /** Current runtime mode. */
  readonly mode: Mode;
  ready(opts?: { game?: string; api?: string }): Promise<ReadyState>;
  submitScore(score: number, opts?: SubmitOptions): Promise<SubmitResult>;
  getScores(opts?: GetScoresOptions): Promise<ScoreEntry[]>;
  getHandle(): string | null;
  setHandle(handle: string): string;
  on(event: EventName, cb: (payload: unknown) => void): HallPass;
  off(event: EventName, cb: (payload: unknown) => void): HallPass;
  /**
   * Resolve the signed-in player's PUBLIC identity (id + display name + avatar +
   * handle), or `null` when there is no session (anonymous, or cross-origin with
   * no cookie) or the client is inert. Reads `GET <api>/api/v1/me` SAME-ORIGIN
   * with credentials and caches the result in memory until `signIn` /
   * `signOut` / `setPlayerHandle`. EMAIL is never part of the result. Never
   * throws. Optional-to-implement (append-only addition); always present on the
   * live client and on the inert stub. Added in v1.
   */
  getPlayer?(): Promise<PlayerIdentity | null>;
  /**
   * Opens a small same-origin popup for Google sign-in; the game document is NOT
   * unloaded. Falls back to a top-level redirect only if the popup is blocked.
   * Cross-origin embeds keep the legacy full-page redirect. Never throws.
   * Added in v1.
   */
  signIn?(opts?: AuthRedirectOptions): void;
  /**
   * Opens a small same-origin popup for Google sign-in; the game document is NOT
   * unloaded. Falls back to a top-level redirect only if the popup is blocked.
   * Cross-origin embeds keep the legacy full-page redirect. Never throws.
   * Added in v1.
   */
  signOut?(opts?: AuthRedirectOptions): void;
  /**
   * Set the signed-in player's chosen handle via `POST <api>/api/v1/me/handle`
   * (same-origin, credentialed). Resolves the updated `PlayerIdentity`, or `null`
   * on any failure / inert mode. Refreshes the in-memory `getPlayer` cache on
   * success. Never throws. Added in v1.
   */
  setPlayerHandle?(handle: string): Promise<PlayerIdentity | null>;
  /**
   * Earn one achievement outright: `POST <api>/api/v1/games/<slug>/achievements`
   * with no progress number, which the server reads as "reach the target".
   *
   * IDEMPOTENT. Calling it for something the player already holds resolves
   * `{ ok: true, unlocked: false, alreadyUnlocked: true }` — never an error, and
   * never a second `"achievement"` event. Requires a signed-in player and a
   * SAME-ORIGIN embed (the endpoint is cookie-credentialed); a cross-origin embed
   * resolves `{ ok: false, reason: "signed-out" }` without firing a doomed
   * request. Never throws. Added in v1.
   */
  unlock?(key: string, opts?: UnlockOptions): Promise<UnlockResult>;
  /**
   * Earn several achievements in ONE request — the case a game hits when
   * finishing a level crosses three thresholds at once. Resolves one
   * {@link UnlockResult} per key, in the order given. Over-long batches are split
   * automatically. Same auth rules as `unlock`. Never throws. Added in v1.
   */
  unlockMany?(keys: string[], opts?: UnlockOptions): Promise<UnlockResult[]>;
  /**
   * Report ABSOLUTE progress toward an achievement ("the player is now at 57"),
   * never a delta.
   *
   * SAFE TO CALL EVERY FRAME: calls are coalesced per key on a ~1s trailing edge,
   * so a 60fps loop produces about one request per second per key, and the
   * pending value is flushed on `pagehide` with a beacon so the FINAL value is
   * never lost. Same auth rules as `unlock`. Never throws. Added in v1.
   */
  progress?(key: string, value: number, opts?: ProgressOptions): Promise<UnlockResult>;
  /**
   * The game's full achievement list as seen by the current player: every
   * achievement with the player's progress and unlocked state, unearned secrets
   * already redacted. Resolves `[]` on any failure or in inert mode — never
   * throws. Added in v1.
   */
  getAchievements?(opts?: GetAchievementsOptions): Promise<PlayerAchievement[]>;
}
