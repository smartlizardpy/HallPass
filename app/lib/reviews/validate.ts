/**
 * HallPass — review text validation.
 *
 * Pure and dependency-free (no `server-only`), so it unit-tests in the plain
 * `node` env like `scoreboard/guard.ts` and `board-input.ts`. The slur list is
 * kept separate and server-only for the same reason usernames do it: a shipped
 * blocklist is a shipped evasion dictionary.
 *
 * THE ORDER OF THE PIPELINE IS LOAD-BEARING. Each step exists to unmask the input
 * for the next one, and reordering them silently reopens the hole the earlier
 * step closed. In particular the zero-width strip MUST precede any word matching:
 * zero-width insertion (`f​u​c​k`) is *the* standard filter bypass,
 * and a wordlist run before it sees a string that contains none of its terms.
 */

export const MIN_REVIEW_LENGTH = 2;
export const MAX_REVIEW_LENGTH = 500;
/** Reject absurd payloads before spending any work decoding them. */
export const MAX_RAW_REVIEW_BYTES = 4096;

export type ReviewRejection =
  | "empty"
  | "too-long"
  | "too-short"
  | "oversized"
  | "links"
  | "contact-info"
  | "flooding"
  | "blocked-word";

export type ReviewValidation =
  | { ok: true; body: string }
  | { ok: false; reason: ReviewRejection };

/** Fixed copy per rejection. Never reflects the submitted text back. */
export const REVIEW_REJECTION_MESSAGES: Record<ReviewRejection, string> = {
  empty: "Write something first",
  "too-short": "That's a bit short — say a little more",
  "too-long": `Reviews can be at most ${MAX_REVIEW_LENGTH} characters`,
  oversized: "That's far too long",
  links: "Links aren't allowed in reviews",
  "contact-info": "Don't share phone numbers, emails or social handles",
  flooding: "That looks like keyboard mashing",
  "blocked-word": "Keep it friendly — that wording isn't allowed",
};

/**
 * Canonicalise the text for STORAGE and display.
 *
 * Steps 1–5 of the pipeline. Deliberately preserves `\n` — reviews are
 * multi-line, unlike a leaderboard handle — which is why this cannot simply reuse
 * `sanitizeHandle` from `players.ts`.
 */
export function normalizeReviewBody(raw: string): string {
  return (
    raw
      // NFKC folds fullwidth and mathematical-alphanumeric homoglyphs (`ｆｕｃｋ`,
      // `𝐟𝐮𝐜𝐤`) down to plain ASCII. `players.ts`'s sanitiser does NOT do this;
      // it is a genuine improvement worth back-porting there.
      .normalize("NFKC")
      // C0/C1 controls and DEL, but NOT \n (0x0a) — see the docblock.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "")
      .replace(/\t/g, " ")
      // Zero-width, BOM, word-joiner, Mongolian vowel separator. In `players.ts`
      // this exists to stop an invisible handle; HERE its primary job is
      // anti-evasion, and it must run before any word matching.
      .replace(/[​-‍﻿⁠᠎]/g, "")
      // Bidirectional overrides and isolates — these can visually reorder text so
      // it overwrites adjacent UI.
      .replace(/[‪-‮⁦-⁩]/g, "")
      .replace(/\r\n?/g, "\n")
      // Collapse runs of blank lines; kills vertical screen-flooding and ASCII art.
      .replace(/\n{3,}/g, "\n\n")
      // Collapse intra-line whitespace without touching the newlines.
      .replace(/[^\S\n]{2,}/g, " ")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .trim()
  );
}

/**
 * Fold text to a comparison skeleton: lowercase, strip diacritics, undo leetspeak
 * and remove every separator.
 *
 * Applied identically to the input and to each blocklist term. That SYMMETRY is
 * what makes the comparison work — folding only one side means `f.u.c.k` never
 * matches `fuck`.
 */
export function reviewSkeleton(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/0/g, "o")
    .replace(/[1l]/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/@/g, "a")
    .replace(/\$/g, "s")
    .replace(/[^a-z0-9]/g, "")
    // Collapse repeated letters so `fuuuck` folds onto `fuck`. Note this also maps
    // `pass` -> `pas`, which is exactly why the blocklist terms must be folded
    // through this same function rather than written in their final form.
    .replace(/(.)\1+/g, "$1");
}

/**
 * Any URL, in any spelling.
 *
 * REVIEWS REJECT LINKS OUTRIGHT, and the over-blocking is intended. This is a
 * site used by school-age players; user-posted links mean phishing, "free robux",
 * grooming invites and off-site content nobody here can moderate. There is no
 * capacity to run a link scanner, so the only defensible policy is none at all.
 * Detection therefore has to be evasion-aware rather than just matching
 * `https?://`.
 */
const LINK_PATTERNS: RegExp[] = [
  /https?:\/\//i,
  /\bwww\./i,
  /\b[a-z0-9-]+\.(com|net|org|gg|io|xyz|ru|tk|me|link|co|uk|dev|app|site|club)\b/i,
  /\b(discord|t)\.(gg|me)\b/i,
  // Spelled-out separators: "example dot com", "http colon slash slash".
  /\bdot\s+(com|net|org|gg|io|me|co)\b/i,
  /\bslash\s*slash\b/i,
];

/**
 * Phone numbers, emails, postcodes and social handles.
 *
 * THIS MATTERS MORE THAN THE WORDLIST. The highest-severity harm on a site aimed
 * at students is not swearing — it is a child publishing their own or a
 * classmate's contact details somewhere public and permanent.
 */
const CONTACT_PATTERNS: RegExp[] = [
  /\d[\d\s().-]{7,}\d/, // phone-shaped run
  /\S+@\S+\.\S+/, // email-shaped
  /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, // UK postcode-shaped
  // A platform name followed by a handle, tolerating one filler word:
  // "snap coolkid99", "my snap is coolkid99", "discord: someone1234".
  //
  // The `(?!\.)` is the important bit: a platform name followed by a DOT is a
  // domain, not a handle, so `discord.gg/abcd` deliberately falls through to the
  // link patterns — "no links" is the accurate explanation there, and both
  // rejections are equally firm either way.
  /\b(snap|snapchat|insta|instagram|discord|kik|whatsapp|telegram|tiktok)\b(?!\.)[\s:@-]*(?:is|are|me|my)?[\s:@-]*[a-z0-9_]{4,}/i,
];

/** Ten or more identical consecutive characters. */
const FLOOD_PATTERN = /(.)\1{9,}/u;

/**
 * Validate and canonicalise a review body.
 *
 * Returns the normalised text on success, so the caller stores exactly what was
 * checked rather than re-deriving it.
 */
export function validateReviewBody(raw: unknown): ReviewValidation {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  if (raw.length > MAX_RAW_REVIEW_BYTES) return { ok: false, reason: "oversized" };

  const body = normalizeReviewBody(raw);
  if (body.length === 0) return { ok: false, reason: "empty" };

  // Code points, not UTF-16 units, so an emoji-heavy review is not cut in half.
  const length = [...body].length;
  if (length < MIN_REVIEW_LENGTH) return { ok: false, reason: "too-short" };
  if (length > MAX_REVIEW_LENGTH) return { ok: false, reason: "too-long" };

  if (FLOOD_PATTERN.test(body)) return { ok: false, reason: "flooding" };
  // Contact info BEFORE links, deliberately. An email address contains a domain,
  // so the link patterns would claim it first and report "links" — technically a
  // rejection, but the wrong explanation for the most safety-critical case on the
  // site. The user needs to be told what they actually did.
  if (CONTACT_PATTERNS.some((re) => re.test(body))) {
    return { ok: false, reason: "contact-info" };
  }
  if (LINK_PATTERNS.some((re) => re.test(body))) return { ok: false, reason: "links" };

  return { ok: true, body };
}

/**
 * Shouting is softened, not rejected.
 *
 * A kid with caps-lock on has not done anything wrong, and bouncing their review
 * back with an error is a worse experience than quietly lowercasing it. Applied
 * only past a length where it is clearly deliberate.
 */
export function softenShouting(body: string): string {
  if (body.length <= 12) return body;
  const letters = body.replace(/[^a-zA-Z]/g, "");
  if (letters.length === 0) return body;
  const upper = body.replace(/[^A-Z]/g, "").length;
  return upper / letters.length > 0.8 ? body.toLowerCase() : body;
}
