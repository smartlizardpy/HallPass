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

export type EventName = "ready" | "scores" | "submitted" | "error" | "auth";

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
}
