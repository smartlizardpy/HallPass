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
}

// ---- Wire types: admin board provisioning -----------------------------------

/** `POST /api/v1/admin/boards` request body (admin-gated). */
export interface CreateBoardRequest {
  slug: string;
  title: string;
  sort?: SortDir;
  scoreLabel?: string;
  maxScore?: number | null;
}

/** Board configuration as stored and echoed back to callers. */
export interface BoardConfig {
  slug: string;
  title: string;
  sort: SortDir;
  scoreLabel: string;
  maxScore: number | null;
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

export type EventName = "ready" | "scores" | "submitted" | "error";

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
}
