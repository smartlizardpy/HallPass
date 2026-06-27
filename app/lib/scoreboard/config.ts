/**
 * HallPass Scoreboard — tunable constants and query-parameter whitelists.
 *
 * Pure, dependency-free (types only). This module is the single place that
 * decides the *bounds* of the scoreboard: the largest score we will ever
 * accept, the anti-spam rate limit, and how many rows a leaderboard page may
 * return. The route handlers and the store both read from here so the limits
 * can never drift apart.
 *
 * Load-bearing decision: every value that originates in an untrusted query
 * string (`?limit`, `?period`, and a board's `sort`) is funnelled through a
 * normaliser here. Those normalisers return one of a fixed set of literals, so
 * downstream SQL can branch on a *whitelisted* enum instead of ever splicing
 * caller input into a statement.
 */

import type { Period, SortDir } from "@/sdk/src/contract";

/** Hard ceiling on any accepted score (1e9). Per-board `maxScore` may be lower. */
export const GLOBAL_MAX_SCORE = 1_000_000_000;

/** Per-IP submission cap: at most 3 writes per rolling 10-second window. */
export const DEFAULT_RATE_LIMIT: RateLimit = {
  maxPerWindow: 3,
  windowSeconds: 10,
};

/** Default leaderboard page size when `?limit` is absent or unparsable. */
export const DEFAULT_LIMIT = 10;

/** Upper bound on `?limit` so a single request cannot scan an entire board. */
export const MAX_LIMIT = 100;

/** Shape of a sliding-window rate limit, shared by the store's `appendScore`. */
export interface RateLimit {
  maxPerWindow: number;
  windowSeconds: number;
}

/**
 * Coerce an arbitrary number into a valid page size in `[1, MAX_LIMIT]`.
 * Non-finite input (e.g. `Number("abc")`) falls back to {@link DEFAULT_LIMIT}.
 */
export function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  const floored = Math.floor(n);
  if (floored < 1) return 1;
  if (floored > MAX_LIMIT) return MAX_LIMIT;
  return floored;
}

const PERIODS: readonly Period[] = ["all", "day", "week"];
const SORT_DIRS: readonly SortDir[] = ["desc", "asc"];

/** Type-guard: is `value` one of the three whitelisted leaderboard windows? */
export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && (PERIODS as readonly string[]).includes(value);
}

/** Type-guard: is `value` a whitelisted sort direction? */
export function isSortDir(value: unknown): value is SortDir {
  return typeof value === "string" && (SORT_DIRS as readonly string[]).includes(value);
}

/** Normalise an untrusted `?period` value to a {@link Period}; default `"all"`. */
export function normalizePeriod(value: unknown): Period {
  return isPeriod(value) ? value : "all";
}

/** Normalise an untrusted sort value to a {@link SortDir}; default `"desc"`. */
export function normalizeSort(value: unknown): SortDir {
  return isSortDir(value) ? value : "desc";
}
