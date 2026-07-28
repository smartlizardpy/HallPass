/**
 * HallPass — display-handle validation for the sign-in chooser.
 *
 * A handle is the free-form name shown on leaderboards, reviews and friends
 * lists. It is NOT the username: handles allow spaces and emoji and are not
 * unique, whereas `username` is a unique lowercase ASCII address.
 *
 * WHY THIS EXISTS ALONGSIDE `sanitizeHandle`. `players.ts` already has a
 * sanitiser, and it COERCES — strips control characters, caps the length, and
 * silently returns "" (stored as NULL) when nothing usable is left. That is the
 * right contract for an API that must never fail. It is the wrong contract for a
 * chooser, where the player is standing in front of the field and needs to be
 * told what is wrong. This module validates and returns a reason; it delegates
 * the actual cleaning so the two can never disagree about what a handle IS.
 *
 * Pure and dependency-free (no `server-only`) so it unit-tests in the `node` env
 * and can drive live feedback in the browser. The slur check is deliberately NOT
 * here — see `hasBlockedDisplayTerm` in `reviews/wordlist.ts`, which is
 * server-only for the usual reason: a shipped blocklist is a shipped evasion
 * dictionary.
 */

export const HANDLE_MIN_LENGTH = 2;
/** Matches the cap in `players.ts` `sanitizeHandle`, which does the storing. */
export const HANDLE_MAX_LENGTH = 24;

export type HandleRejection = "empty" | "too-short" | "too-long" | "reserved";

export type HandleValidation =
  | { ok: true; handle: string }
  | { ok: false; reason: HandleRejection };

export const HANDLE_REJECTION_MESSAGES: Record<HandleRejection, string> = {
  empty: "Pick a name",
  "too-short": `At least ${HANDLE_MIN_LENGTH} characters, please`,
  "too-long": `At most ${HANDLE_MAX_LENGTH} characters`,
  reserved: "That name isn't available",
};

/**
 * Names that would let someone pose as the site or as staff.
 *
 * Compared against a lowercased, space-stripped form, so "Hall Pass" and
 * "hallpass" are the same claim.
 */
const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "hallpass", "hallpassteam", "hallpassstaff", "hallpassofficial",
  "admin", "administrator", "moderator", "mod", "staff", "official",
  "system", "support", "owner", "root", "everyone", "here",
]);

/**
 * Clean a handle for display and storage.
 *
 * Mirrors `players.ts` `sanitizeHandle` exactly — the same control-character,
 * zero-width and bidi strips, the same collapse and cap. Duplicated rather than
 * imported because that module is server-only (it reaches for `sql`), and this
 * one has to run in the browser for live feedback. The two must be kept in step;
 * a divergence would show the player one thing and store another.
 */
export function cleanHandle(raw: string): string {
  return (
    raw
      // C0/C1 control characters and DEL.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
      // Zero-width and BOM — these render as a blank or invisible handle.
      .replace(/[​-‍﻿⁠]/g, "")
      // Bidirectional overrides and isolates. On a leaderboard these can visually
      // reorder a row so it overwrites the rows around it.
      .replace(/[‪-‮⁦-⁩]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, HANDLE_MAX_LENGTH)
      .trim()
  );
}

/** Comparison form for the reserved check: lowercase, no spaces or punctuation. */
function handleKey(handle: string): string {
  return handle.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function validateHandle(raw: unknown): HandleValidation {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  if (raw.length > 500) return { ok: false, reason: "too-long" };

  const handle = cleanHandle(raw);
  if (handle.length === 0) return { ok: false, reason: "empty" };

  // Code points, so an emoji counts as one character rather than two.
  const length = [...handle].length;
  if (length < HANDLE_MIN_LENGTH) return { ok: false, reason: "too-short" };

  if (RESERVED_HANDLES.has(handleKey(handle))) {
    return { ok: false, reason: "reserved" };
  }

  return { ok: true, handle };
}

/**
 * A first-name-only suggestion derived from the Google profile name.
 *
 * DELIBERATELY DROPS THE SURNAME. The whole point of asking for a handle is that
 * the current default — falling back to `players.name` — publishes the player's
 * FULL real name on every leaderboard. Offering the full name back as a
 * suggestion would reproduce exactly that, just with a click in between. A first
 * name is a much smaller disclosure and is still recognisable to friends, and the
 * field stays editable, so nobody is pushed into keeping it.
 *
 * Returns "" when there is nothing usable, so the caller shows an empty field
 * rather than a placeholder pretending to be a name.
 */
export function suggestHandleFromName(name: string | null | undefined): string {
  if (!name) return "";
  const first = cleanHandle(name).split(" ")[0] ?? "";
  return [...first].length >= HANDLE_MIN_LENGTH ? first : "";
}
