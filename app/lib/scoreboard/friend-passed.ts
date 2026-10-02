/**
 * HallPass — the identity of a "a friend passed your score" event (pure).
 *
 * Separate from the notify module, which is `server-only`, so the key — the one
 * part with a correctness argument — can be unit-tested in plain Node.
 *
 * ── WHAT "THE SAME EVENT" MEANS ────────────────────────────────────────────
 * `deliver.ts` suffixes the recipient onto any key, so this only has to say what
 * happened: THIS player passed THAT score on THIS board. Including the passed
 * score is what makes each distinct overtake tellable once:
 *
 *   - the same submit retried, or two near-simultaneous submits, collapse into
 *     one notification;
 *   - a friend who later re-takes the lead and is passed AGAIN has a different
 *     score on the line, so that is a new event and is told.
 *
 * Without the score in the key a pair would be told once per board for ever.
 */

export function friendPassedDedupeKey(input: {
  boardId: string;
  /** Internal id of whoever did the passing. */
  passerId: string;
  /** The score that was passed — the recipient's own best on the board. */
  passedBest: number;
}): string {
  return `friend_passed:${input.boardId}:${input.passerId}:${input.passedBest}`;
}
