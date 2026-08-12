/**
 * HallPass — challenge-link codes and link state.
 *
 * PURE. No database, no `server-only`, no clock beyond what a caller passes in
 * — the sibling of `challenges/resolve.ts` and `challenges/config.ts`, and read
 * by the store, the routes AND the client islands, so the rule the URL bar
 * enforces cannot drift from the one the lookup enforces.
 *
 * ── WHY A LINK CODE IS NOT A FRIEND CODE, DESPITE THE SHARED ALPHABET ──────
 * Both draw on `FRIEND_CODE_ALPHABET` for the same two reasons: no confusable
 * pairs, so a code retyped from a photo of somebody's screen lands on one
 * unambiguous target; and no vowels, so no code can accidentally spell
 * anything. A code that goes in a group chat gets read aloud and retyped, so
 * both properties matter more here than they do on the account page.
 *
 * They differ in two ways that matter:
 *
 *  1. **LONGER.** A friend code is 8 characters (~2.8e11) and is only ever
 *     looked up by somebody who was told it. A link code sits on a PUBLIC,
 *     unauthenticated route that anybody may probe, and what it exposes is a
 *     child's handle. 10 characters takes the space to ~2e14 — enumeration
 *     stops being a strategy — for the cost of two characters nobody types.
 *
 *  2. **NEVER NORMALISED THROUGH `normalizeFriendCode`.** That function strips
 *     a leading `HP`, which is the display prefix of a friend code and nothing
 *     to do with links. `H` and `P` are both in the alphabet, so a link code
 *     that happened to begin `HP` would be silently shortened by two characters
 *     and could never resolve. {@link normalizeLinkCode} folds and filters
 *     without that step.
 *
 * ── THERE IS NO CHECK DIGIT AND NO DISPLAY FORM ────────────────────────────
 * Friend codes are read aloud and typed in, so they earn `HP-XXXX-XXXX`. A link
 * is tapped, not transcribed — the whole feature is a URL in a chat — so a
 * display form would be decoration on a string most people never see. The
 * normaliser is forgiving anyway, for the minority who do retype one.
 */

import {
  FRIEND_CODE_ALPHABET,
  FRIEND_CODE_FOLD,
  isUnfortunateFriendCode,
} from "@/app/lib/username";

/** See the header: longer than a friend code because the route is public. */
export const LINK_CODE_LENGTH = 10;

/** How many times {@link generateLinkCode} retries an unfortunate code. */
const MAX_GENERATION_ATTEMPTS = 8;

/**
 * A random code from the confusable-free alphabet.
 *
 * `crypto.getRandomValues` with rejection-free modulo, matching
 * `api/v1/me/friend-code`: the bias from `% 27` over a byte is negligible for a
 * value whose only job is to be unguessable in a 2e14 space.
 *
 * Regenerates on an unfortunate consonant skeleton. With every vowel gone from
 * the alphabet real words cannot form, but clusters still read as slurs — and
 * this one goes in a URL somebody posts publicly under their own name, which is
 * a worse place for one than the account page the blocklist was written for.
 */
export function generateLinkCode(): string {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const bytes = new Uint8Array(LINK_CODE_LENGTH);
    crypto.getRandomValues(bytes);
    let code = "";
    for (const byte of bytes) {
      code += FRIEND_CODE_ALPHABET[byte % FRIEND_CODE_ALPHABET.length];
    }
    if (!isUnfortunateFriendCode(code)) return code;
  }
  // Exhausting the attempts is vanishingly unlikely. Falling through to a
  // guaranteed-clean constant would be worse than one more roll of the dice:
  // it would be a code two people could be issued at once.
  const bytes = new Uint8Array(LINK_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += FRIEND_CODE_ALPHABET[byte % FRIEND_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Canonicalise a code that arrived from a URL, uppercasing and folding
 * confusables. Returns `""` when nothing valid remains, so a caller can treat
 * empty as "not a code" rather than guessing.
 *
 * Deliberately NOT `normalizeFriendCode` — see the header.
 */
export function normalizeLinkCode(raw: string): string {
  const cleaned = String(raw ?? "").toUpperCase().replace(/[\s-_]/g, "");
  let out = "";
  for (const char of cleaned) {
    const folded = FRIEND_CODE_FOLD[char] ?? char;
    if (FRIEND_CODE_ALPHABET.includes(folded)) out += folded;
  }
  return out;
}

/** Whether a normalised code is the right shape to bother querying for. */
export function isValidLinkCode(value: string): boolean {
  return (
    value.length === LINK_CODE_LENGTH &&
    [...value].every((c) => FRIEND_CODE_ALPHABET.includes(c))
  );
}

/**
 * The site-relative path a code lives at.
 *
 * Relative on purpose: the client builds the shareable URL from
 * `location.origin`, so a preview deployment shares a preview link and nothing
 * has to thread `SITE_URL` into a browser bundle.
 */
export function challengeLinkPath(code: string): string {
  return `/c/${encodeURIComponent(code)}`;
}

/**
 * Why a link cannot be played, or `null` when it can.
 *
 * Read-time evaluation, like every other time-ish rule in this subsystem —
 * there is no cron, so nothing may depend on a sweeper having run. `revoked` is
 * the only ending a link has; there is deliberately no expiry (see
 * `challenge-sharing-design.md` §12).
 */
export type LinkUnavailable = "missing" | "revoked";

export function linkUnavailableReason(
  link: { revokedAt: string | null } | null | undefined,
): LinkUnavailable | null {
  if (!link) return "missing";
  if (link.revokedAt !== null) return "revoked";
  return null;
}
