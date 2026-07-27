/**
 * HallPass — the review blocklist.
 *
 * ⚠️ Contains offensive strings by necessity. It exists to keep them off a page
 * a class of children can read.
 *
 * `import "server-only"` is deliberate: a shipped blocklist is a shipped evasion
 * dictionary. The shape checks in `validate.ts` are pure and ship to the browser
 * for instant feedback; this does not, so word-block errors only appear on
 * submit. That asymmetry is intentional.
 *
 * ── TWO MATCH MODES, and this is the part that was wrong the first time ──────
 *
 * WORD terms are compared against WHOLE WORDS. Short terms embed inside ordinary
 * English — `rape` in "grape", `spic` in "suspicious", `pedo` in "pedometer",
 * `hate` in "whatever" — so matching them as substrings rejects innocent
 * reviews. Whole-word comparison catches the slur and leaves the word alone.
 *
 * LOOSE terms are compared as SUBSTRINGS of the whole separator-stripped text.
 * That is what catches evasion — `f.u.c.k`, `f u c k`, `xxfuckxx`, `fuuuck` —
 * and it is only safe for terms that do not occur inside real words. Every entry
 * in that list has been checked against ordinary English; the one knowing
 * exception is `cunt`, which costs us the town of Scunthorpe.
 *
 * The input is tested in BOTH plain and repeat-collapsed form, so `fuuuck`
 * matches `fuck` without the term itself ever being collapsed. Collapsing terms
 * is what previously turned `kkk` into `k` and rejected every review containing
 * the letter K.
 *
 * ── TWO SEVERITY TIERS ──────────────────────────────────────────────────────
 *
 *   BLOCKED — refused outright.
 *   FLAGGED — the review POSTS but is stored `hidden` and queued for review. This
 *             is what lets the blocked list stay firm without making the product
 *             unusable: a borderline review reaches a human rather than being
 *             invisible by default or published unseen.
 *
 * HONEST LIMITS, worth writing down so nobody develops false confidence: a list
 * cannot catch vowel-dropping (`fck`), phonetic respelling (`phuck`), novel or
 * coded slang, non-English abuse, emoji-encoded abuse, or — the one that matters
 * most — targeted bullying containing no bad words at all ("everyone knows what
 * [name] did in PE"). Its job is to make casual profanity annoying. The report
 * queue, the one-review-per-player cap and the verified Google identity behind
 * every review are what actually do the work.
 */

import "server-only";
import { collapseRepeats, reviewSkeleton, reviewWordSkeletons } from "./validate";

/**
 * Refused outright, matched as SUBSTRINGS.
 *
 * Every entry here must not occur inside an ordinary English word — that is the
 * entry criterion for this list, not severity.
 */
const BLOCKED_LOOSE = [
  "nigger", "nigga", "faggot", "tranny", "wetback", "beaner", "raghead",
  "retard", "hitler", "nazi", "kkk",
  "rapist", "molest", "hentai", "dildo",
  "killyourself", "killurself", "neckyourself",
  "fuck", "motherfucker", "cunt", "whore", "slut", "porn",
];

/**
 * Refused outright, matched as WHOLE WORDS.
 *
 * These are here because each one embeds in innocent English: `rape` in "grape",
 * `spic` in "suspicious", `coon` in "raccoon", `pedo` in "pedometer", `chink` in
 * "a chink in the armour".
 */
const BLOCKED_WORD = [
  "rape", "spic", "coon", "gook", "kike", "chink", "paki", "pedo", "paedo",
  "kys", "kms",
];

/** Posts but hidden pending review, matched as WHOLE WORDS. */
const FLAGGED_WORD = [
  "shit", "bitch", "bastard", "wanker", "dickhead", "asshole", "arsehole",
  "bollocks", "twat", "prick", "damn", "crap", "piss", "arse", "dick",
  "idiot", "stupid", "loser", "trash", "garbage", "sucks", "hate", "dumb",
];

/**
 * Terms folded at module load — with {@link reviewSkeleton}, which does NOT
 * collapse repeats. Folding both sides through the same function is what makes
 * `f.u.c.k` match `fuck`; NOT collapsing the term is what stops `kkk` becoming
 * `k`.
 */
const LOOSE = new Set(BLOCKED_LOOSE.map(reviewSkeleton));
const WORD_BLOCKED = new Set(BLOCKED_WORD.map(reviewSkeleton));
const WORD_FLAGGED = new Set(FLAGGED_WORD.map(reviewSkeleton));

export type WordVerdict = "clean" | "flagged" | "blocked";

/** Classify a normalised review body. */
export function containsBlockedReviewTerm(body: string): WordVerdict {
  // Whole text, separators stripped — checked in both plain and collapsed form so
  // `fuuuck` matches without the term ever being collapsed.
  const dense = reviewSkeleton(body);
  const denseCollapsed = collapseRepeats(dense);
  for (const term of LOOSE) {
    if (dense.includes(term) || denseCollapsed.includes(term)) return "blocked";
  }

  // Per-word, for the short terms that would otherwise hit innocent English.
  const words = reviewWordSkeletons(body);
  for (const term of WORD_BLOCKED) {
    if (words.has(term)) return "blocked";
  }
  for (const term of WORD_FLAGGED) {
    if (words.has(term)) return "flagged";
  }

  return "clean";
}
