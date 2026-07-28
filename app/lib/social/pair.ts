/**
 * HallPass — the ordered-pair key for `friendships`.
 *
 * `friendships` stores ONE ROW PER PAIR with `player_a < player_b`, so every
 * query has to agree with the database about which id sorts first. This module is
 * that agreement, in one place, so it cannot drift.
 *
 * Pure and dependency-free — unit-testable in the plain `node` environment.
 */

/**
 * Order two player ids the way the `friendships_ordered_chk` CHECK does.
 *
 * The comparison MUST be byte order, which is what `COLLATE "C"` pins on the
 * database side. It is easy to assume this is irrelevant because `players.id` is
 * "just a Google subject id" — a numeric string, where every collation agrees.
 * But `app/lib/auth.ts` falls back to `profile?.sub ?? user.id`, and `user.id` is
 * a HYPHENATED UUID. Hyphens are exactly where ICU collations diverge from byte
 * order: under `en_US.UTF-8` punctuation is weighted differently, so a JS
 * comparison (which is UTF-16 code-unit order, i.e. byte order for ASCII) and an
 * un-pinned Postgres comparison can disagree — and the CHECK would reject a
 * perfectly legitimate insert for one pair in a thousand, seemingly at random.
 *
 * JS `<` on strings is already code-unit order, so it matches `COLLATE "C"` for
 * the ASCII ids in play here. The pin is on the DB side; this comment is why.
 */
export function orderPair(x: string, y: string): { lo: string; hi: string } {
  return x < y ? { lo: x, hi: y } : { lo: y, hi: x };
}

/** Whether two ids name the same player — self-friending, self-blocking, etc. */
export function isSelf(x: string, y: string): boolean {
  return x === y;
}

/**
 * Given a pair row and the viewer, return the OTHER player's id.
 *
 * The read side of one-row-per-pair: rows are found with
 * `WHERE player_a = $me OR player_b = $me`, so every consumer needs this.
 */
export function otherSide(
  row: { playerA: string; playerB: string },
  me: string,
): string {
  return row.playerA === me ? row.playerB : row.playerA;
}
