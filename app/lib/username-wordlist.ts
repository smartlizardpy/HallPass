/**
 * HallPass — the username slur/profanity blocklist.
 *
 * ⚠️ This file necessarily contains offensive strings. It exists to keep them off
 * public leaderboards, friends lists and profile URLs.
 *
 * `import "server-only"` is DELIBERATE and load-bearing. Format and reserved-word
 * checks live in `username.ts` (no such guard) so the browser can give instant
 * typeahead feedback; this list must never reach a client bundle, because a
 * shipped blocklist is a shipped evasion dictionary — anyone can diff it to find
 * exactly which spellings are still available.
 *
 * The practical consequence for the UI: shape errors appear as the user types,
 * word-block errors appear on submit. That asymmetry is intentional.
 *
 * THE SCUNTHORPE TRADE-OFF IS INVERTED HERE, on purpose, and this is the note
 * someone will eventually want to "fix":
 *
 *   Matching is SUBSTRING, not word-boundary, against the confusable skeleton.
 *   That over-blocks — a name containing an unfortunate substring is rejected
 *   even when innocent.
 *
 *   For a chat message the usual advice is the opposite, because a false block
 *   costs a real message. For a USERNAME it is not: a false rejection costs one
 *   retry at signup, while a false ACCEPT puts a slur on every leaderboard, in
 *   every friends list, and at a public URL, indefinitely. Substring matching is
 *   also the only thing that catches `xxslurxx`, since usernames have no word
 *   boundaries to anchor to.
 *
 * HONEST LIMITS. A list cannot catch vowel-dropping, novel or coded slang,
 * non-English abuse, or a name that is only offensive in context. It makes casual
 * abuse annoying; the report path and the small surface do the rest.
 */

import "server-only";
import { confusableSkeleton } from "@/app/lib/username";

/**
 * Terms rejected outright, stored in SKELETON form.
 *
 * Skeletonising at module load is what makes the comparison sound: the input is
 * folded the same way, so `4ss` and `ass` land on the same string. Adding a term
 * here in raw form is fine — it is folded on the way into the set.
 */
const RAW_BLOCKED = [
  // Slurs and hate terms.
  "nigger", "nigga", "faggot", "fag", "tranny", "chink", "spic", "kike",
  "gook", "wetback", "retard", "paki", "coon", "beaner", "raghead",
  "hitler", "nazi", "kkk", "heil",
  // Sexual.
  "rape", "rapist", "molest", "pedo", "paedo", "cum", "porn", "hentai",
  "dildo", "penis", "vagina", "boner", "horny", "milf", "bdsm",
  // Self-harm — matters more than most profanity on a site used by children.
  "killyourself", "kys", "suicide", "selfharm", "cutter",
  // General profanity.
  "fuck", "shit", "cunt", "bitch", "whore", "slut", "bastard", "wanker",
  "dickhead", "asshole", "arsehole", "bollocks", "twat", "prick",
];

const BLOCKED_SKELETONS: ReadonlySet<string> = new Set(
  RAW_BLOCKED.map(confusableSkeleton),
);

/**
 * Whether a (already format-validated) username contains a blocked term.
 *
 * The username is folded to its skeleton first, so leetspeak and underscore
 * padding — `f_u_c_k`, `fvck`-style digit swaps, `4ss` — collapse onto the same
 * form as the list entry.
 */
export function containsBlockedTerm(username: string): boolean {
  const skeleton = confusableSkeleton(username);
  for (const term of BLOCKED_SKELETONS) {
    if (skeleton.includes(term)) return true;
  }
  return false;
}
