/**
 * HallPass Scoreboard — shared, dependency-free input validation for board
 * provisioning. ONE normalisation path, consumed by BOTH the admin API route
 * (`app/api/v1/admin/boards/route.ts`) and the dashboard server actions, so the
 * two surfaces can never drift on what counts as a valid board id, title, sort,
 * score label, max score, or game link.
 *
 * This module imports the contract's TYPES ONLY — no runtime dependency, no DB,
 * no knowledge of the games list. The caller injects `isKnownGame` so the same
 * validator works wherever the static games array lives (and stays trivially
 * unit-testable with a stub predicate).
 */

import type { CreateBoardRequest } from "@/sdk/src/contract";

/**
 * Valid board id shape — mirrors the `boards.id` CHECK constraint in
 * `schema.sql` (`^[a-z0-9][a-z0-9-]*$`): lowercase alphanumerics and hyphens,
 * never leading with a hyphen. Keep the two in lockstep.
 */
export const BOARD_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Upper bound on a board id's length (defensive; ids are URL path segments). */
export const MAX_BOARD_ID_LENGTH = 64;

/** True when `id` is a well-formed, length-bounded board id. */
export function isValidBoardId(id: string): boolean {
  return id.length <= MAX_BOARD_ID_LENGTH && BOARD_ID_RE.test(id);
}

/** A single field-level validation failure, surfaced to the caller verbatim. */
export type BoardInputError = { field: string; message: string };

/** Discriminated result: a normalised request, or the first field error. */
export type ParseBoardInputResult =
  | { ok: true; value: CreateBoardRequest }
  | { ok: false; error: BoardInputError };

/** Raw, untrusted board input as it arrives from a JSON body or a form. */
export interface RawBoardInput {
  slug?: unknown;
  title?: unknown;
  sort?: unknown;
  scoreLabel?: unknown;
  maxScore?: unknown;
  gameSlug?: unknown;
}

/** Options injected by the caller — chiefly the games-list membership test. */
export interface ParseBoardInputOptions {
  isKnownGame: (slug: string) => boolean;
}

/**
 * Validate and NORMALISE raw board input into a `CreateBoardRequest`.
 *
 * Rules:
 *  - `slug`        required; trimmed; must satisfy `isValidBoardId`.
 *  - `title`       required; trimmed; non-empty.
 *  - `sort`        `'asc'` | `'desc'`; anything else collapses to `undefined`
 *                  (the store then defaults to `desc`).
 *  - `scoreLabel`  passed through only when a string; else `undefined`.
 *  - `maxScore`    `null`, or a finite number `>= 0`; negative/NaN is rejected;
 *                  `undefined`/absent stays `undefined`.
 *  - `gameSlug`    a non-empty string must name a known game (else error);
 *                  explicit `null` means standalone; when ABSENT it DEFAULTS to
 *                  `slug` if `slug` itself names a known game, otherwise `null`.
 */
export function parseCreateBoardInput(
  raw: RawBoardInput,
  opts: ParseBoardInputOptions,
): ParseBoardInputResult {
  // slug — required, trimmed, well-formed.
  if (typeof raw.slug !== "string") {
    return { ok: false, error: { field: "slug", message: "Slug is required" } };
  }
  const slug = raw.slug.trim();
  if (slug.length === 0) {
    return { ok: false, error: { field: "slug", message: "Slug is required" } };
  }
  if (!isValidBoardId(slug)) {
    return {
      ok: false,
      error: {
        field: "slug",
        message: "Slug must be lowercase letters, numbers, and hyphens",
      },
    };
  }

  // title — required, trimmed, non-empty.
  if (typeof raw.title !== "string") {
    return { ok: false, error: { field: "title", message: "Title is required" } };
  }
  const title = raw.title.trim();
  if (title.length === 0) {
    return { ok: false, error: { field: "title", message: "Title is required" } };
  }

  // sort — whitelist; anything else becomes undefined (store defaults to desc).
  const sort = raw.sort === "asc" || raw.sort === "desc" ? raw.sort : undefined;

  // scoreLabel — pass through only when a string.
  const scoreLabel = typeof raw.scoreLabel === "string" ? raw.scoreLabel : undefined;

  // maxScore — null | finite >= 0 | undefined; reject negatives / NaN.
  let maxScore: number | null | undefined;
  if (raw.maxScore === null) {
    maxScore = null;
  } else if (raw.maxScore === undefined) {
    maxScore = undefined;
  } else if (typeof raw.maxScore === "number" && Number.isFinite(raw.maxScore) && raw.maxScore >= 0) {
    maxScore = raw.maxScore;
  } else {
    return {
      ok: false,
      error: { field: "maxScore", message: "Max score must be a non-negative number" },
    };
  }

  // gameSlug — explicit link, explicit standalone, default-from-slug, or reject.
  let gameSlug: string | null;
  if (raw.gameSlug === null) {
    // Explicit standalone.
    gameSlug = null;
  } else if (raw.gameSlug === undefined) {
    // Absent: default to the slug when it names a known game — preserves the
    // legacy "provision a game's board" behaviour.
    gameSlug = opts.isKnownGame(slug) ? slug : null;
  } else if (typeof raw.gameSlug === "string") {
    if (raw.gameSlug.length === 0) {
      // Empty string behaves like absent (default-from-slug).
      gameSlug = opts.isKnownGame(slug) ? slug : null;
    } else if (!opts.isKnownGame(raw.gameSlug)) {
      return { ok: false, error: { field: "gameSlug", message: "Unknown game" } };
    } else {
      gameSlug = raw.gameSlug;
    }
  } else {
    // A non-string, non-null value (number/boolean/object) is malformed — reject
    // rather than silently coercing it to a default link.
    return { ok: false, error: { field: "gameSlug", message: "Unknown game" } };
  }

  return { ok: true, value: { slug, title, sort, scoreLabel, maxScore, gameSlug } };
}
