/**
 * HallPass — what a refused challenge says to the player who tried to send it.
 *
 * PURE. No database, no `window`, no clock — the sibling of
 * `notifications/copy.ts`, and split from `config.ts` for the same reason that
 * module is split from its own: `config.ts` owns the VOCABULARY (which refusals
 * exist, and what each one means to the server), this owns the WORDING.
 *
 * ── WHY THIS IS NOT A `Record<string, string>` IN THE COMPONENT ────────────
 * It was one, in `ChallengeEmbed.tsx`, and it worked — but it was keyed by
 * `string`, so a new member of `CHALLENGE_REASONS` would have compiled fine and
 * shipped a refusal that silently rendered the `unavailable` fallback. Typing
 * the map as `Record<ChallengeReason, string>` makes that a BUILD ERROR
 * instead: add a reason, and TypeScript demands the sentence before the branch
 * merges.
 *
 * That mattered enough to move once there was a SECOND surface. The in-game
 * picker and the profile page both refuse for the same eight reasons, and two
 * hand-maintained copies of this map is precisely how one of them comes to say
 * something the other does not.
 *
 * ── THE WORDING RULES, WHICH ARE WHY THE STRINGS LIVE TOGETHER ─────────────
 *
 *  1. NOTHING HERE MENTIONS BLOCKING, and `copy.test.ts` asserts it across the
 *     whole set. `config.ts` explains at length why there is no `"blocked"`
 *     reason: a block deletes the friendship, so it is unreachable behind
 *     `not-friends` — and reporting it would confirm to somebody that a
 *     specific person had blocked them, which is the one thing a block exists
 *     to prevent. A sentence here that said "they have blocked you" would
 *     reintroduce that disclosure at the last possible moment.
 *
 *  2. EVERY REFUSAL SAYS WHAT TO DO, or admits that there is nothing to do.
 *     These are read by children, at the moment something they tried did not
 *     work. "Invalid request" is not an acceptable thing to show them.
 *
 *  3. NO NUMBERS AND NO NAMES. A refusal is rendered in a small panel that may
 *     be over a game, and the reasons a challenge bounces are never specific to
 *     a person — `rate-limited` covers both "you have sent a lot today" and
 *     "you challenged this person an hour ago", deliberately, because the route
 *     collapses the three limits into one reason so that neither is confirmable
 *     by probing.
 */

import type { ChallengeReason } from "./config";

/**
 * One sentence per refusal, exhaustive over {@link ChallengeReason}.
 *
 * `satisfies` rather than a bare annotation so the object keeps its literal
 * type for callers while still failing the build if a reason is missing.
 */
export const CHALLENGE_REFUSAL_TEXT = {
  "no-board": "This game has no leaderboard to challenge on.",
  "no-score": "Set a score here first, then dare a friend to beat it.",
  "not-friends": "You can only challenge friends.",
  self: "You cannot challenge yourself.",
  "signed-out": "Sign in to challenge a friend.",
  "bad-request": "Something about this game's leaderboard is not set up right.",
  "rate-limited": "Not right now — give it a little while.",
  unavailable: "Challenges are unavailable at the moment.",
} as const satisfies Record<ChallengeReason, string>;

/**
 * The sentence for a refusal that arrived over the wire.
 *
 * Takes `unknown` rather than `ChallengeReason` on purpose: every caller is
 * reading a field out of a parsed JSON body, where the type is a promise the
 * server makes and not one the client can check. A reason this build has never
 * heard of — an older client against a newer route — degrades to
 * `unavailable`, which is vague but true, rather than rendering `undefined`.
 *
 * THE RESULT IS TYPE-CHECKED, NOT `?? `-DEFAULTED, and the version this
 * replaced got that wrong. A bare index signature reaches `Object.prototype`,
 * so a body carrying `{"reason":"constructor"}` resolved to a FUNCTION — which
 * is not nullish, so `??` passed it straight through to be rendered. Checking
 * that what came back is a string closes every inherited key at once.
 *
 * `Object.hasOwn` would say this more directly and is deliberately not used:
 * it is a runtime method with no polyfill here, unsupported before Safari 15.4,
 * and this renders on whatever hardware a school happens to own.
 */
export function challengeRefusalText(reason: unknown): string {
  const text = CHALLENGE_REFUSAL_TEXT[reason as ChallengeReason];
  return typeof text === "string" ? text : CHALLENGE_REFUSAL_TEXT.unavailable;
}
