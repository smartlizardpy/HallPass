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
 * TWO TIERS, which is the structurally important part:
 *
 *   BLOCKED — refused outright. Matched aggressively against the folded skeleton,
 *             accepting Scunthorpe-class false positives. On a school site a
 *             false block costs one retry; a false ALLOW costs a class seeing a
 *             slur.
 *   FLAGGED — mild or ambiguous. The review POSTS but is stored `hidden` and
 *             lands in the moderation queue. Two tiers are what let the blocked
 *             list stay aggressive without making the product unusable, and mean
 *             a borderline review reaches a human instead of being invisible by
 *             default or published unseen.
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
import { reviewSkeleton } from "./validate";

/** Refused outright. */
const RAW_BLOCKED = [
  // Slurs and hate terms.
  "nigger", "nigga", "faggot", "tranny", "chink", "spic", "kike", "gook",
  "wetback", "paki", "coon", "beaner", "raghead", "retard",
  "hitler", "nazi", "kkk",
  // Sexual.
  "rape", "rapist", "molest", "pedo", "paedo", "porn", "hentai", "dildo",
  // Self-harm — this matters more on this site than any swear word.
  "killyourself", "kys", "killurself", "neckyourself",
  // Strong profanity.
  "cunt", "whore", "slut", "fuck", "motherfucker",
];

/** Posts, but hidden pending review. */
const RAW_FLAGGED = [
  "shit", "bitch", "bastard", "wanker", "dickhead", "asshole", "arsehole",
  "bollocks", "twat", "prick", "damn", "crap", "piss", "idiot", "stupid",
  "loser", "trash", "garbage", "sucks", "hate",
];

/**
 * Both lists folded at module load.
 *
 * Folding both sides is what makes the comparison sound — `f.u.c.k` only matches
 * `fuck` once `fuck` has been through the same function. Terms can therefore be
 * written here in plain form.
 */
const BLOCKED = new Set(RAW_BLOCKED.map(reviewSkeleton));
const FLAGGED = new Set(RAW_FLAGGED.map(reviewSkeleton));

export type WordVerdict = "clean" | "flagged" | "blocked";

/**
 * Classify a normalised review body.
 *
 * Substring matching against the skeleton, not word-boundary: separators are
 * stripped during folding, so there are no boundaries left to anchor to, and
 * `xxslurxx` has to be caught.
 */
export function containsBlockedReviewTerm(body: string): WordVerdict {
  const skeleton = reviewSkeleton(body);
  for (const term of BLOCKED) {
    if (skeleton.includes(term)) return "blocked";
  }
  for (const term of FLAGGED) {
    if (skeleton.includes(term)) return "flagged";
  }
  return "clean";
}
