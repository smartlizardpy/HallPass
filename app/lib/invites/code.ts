/**
 * HallPass — invite codes.
 *
 * PURE, like `challenges/link.ts`, whose reasoning this follows: the code sits on
 * a PUBLIC, unauthenticated page (`/i/<code>`) that anybody may probe, and what
 * it exposes is a child's display name and the game they are in right now.
 *
 * ── THE SAME ALPHABET AS FRIEND AND LINK CODES ──────────────────────────────
 * `FRIEND_CODE_ALPHABET` has no confusable pairs (a code retyped from a photo of
 * a screen lands on one target) and no vowels (no code can spell a word). It is
 * folded and filtered by {@link normalizeInviteCode} without ever going through
 * `normalizeFriendCode`, which strips a leading `HP` — `H` and `P` are in the
 * alphabet, so that would silently shorten a code beginning `HP`.
 *
 * ── TWELVE CHARACTERS ──────────────────────────────────────────────────────
 * Two more than a challenge link. 27^12 is ~1.5e17, and an invite lives at most
 * two hours: there is nothing to enumerate. The cost is two characters nobody
 * types, because an invite is tapped, not transcribed.
 */

import {
  FRIEND_CODE_ALPHABET,
  FRIEND_CODE_FOLD,
  isUnfortunateFriendCode,
} from "@/app/lib/username";

/** See the header. Pinned by the CHECK in `041_game_invites.sql`. */
export const INVITE_CODE_LENGTH = 12;

/** How many times {@link generateInviteCode} rerolls an unfortunate code. */
const MAX_GENERATION_ATTEMPTS = 8;

function randomCode(): string {
  const bytes = new Uint8Array(INVITE_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    // Modulo bias over 27 is negligible for a value whose only job is to be
    // unguessable — the same trade `generateLinkCode` makes.
    code += FRIEND_CODE_ALPHABET[byte % FRIEND_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * A fresh random code. Rerolls a consonant skeleton that reads as a slur — this
 * one goes in a URL somebody posts in a group chat.
 */
export function generateInviteCode(): string {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const code = randomCode();
    if (!isUnfortunateFriendCode(code)) return code;
  }
  // Practically unreachable. Another roll beats a fixed fallback, which would be
  // a code two invites could share.
  return randomCode();
}

/**
 * Canonicalise a code from a URL: uppercase, drop separators, fold confusables,
 * drop anything else. Returns `""` when nothing valid remains.
 */
export function normalizeInviteCode(raw: unknown): string {
  const cleaned = String(raw ?? "").toUpperCase().replace(/[\s_-]/g, "");
  let out = "";
  for (const char of cleaned) {
    const folded = FRIEND_CODE_FOLD[char] ?? char;
    if (FRIEND_CODE_ALPHABET.includes(folded)) out += folded;
  }
  return out;
}

/** Whether a normalised code is the right shape to bother querying for. */
export function isValidInviteCode(value: string): boolean {
  return (
    value.length === INVITE_CODE_LENGTH &&
    [...value].every((c) => FRIEND_CODE_ALPHABET.includes(c))
  );
}

/**
 * The site-relative path an invite lives at. Relative on purpose, like
 * `challengeLinkPath`: the browser builds the shareable URL from its own
 * `location.origin`, so a preview deployment shares a preview link.
 */
export function invitePath(code: string): string {
  return `/i/${encodeURIComponent(code)}`;
}
