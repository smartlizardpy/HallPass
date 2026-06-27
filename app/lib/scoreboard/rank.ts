/**
 * HallPass Scoreboard — pure ranking semantics.
 *
 * No IO, no `server-only`: this module exists purely to *pin* the ordering
 * contract that the SQL in `store.ts` relies on, so unit tests can assert the
 * tie-break without a database. The rule, mirrored verbatim by the leaderboard
 * indexes and `ORDER BY` clauses, is:
 *
 *   1. by `score` (DESC for `sort:"desc"`, ASC for `sort:"asc"`),
 *   2. then the EARLIER `createdAt` wins the tie,
 *   3. then the LOWER `id` wins (the final deterministic tie-break).
 *
 * "Rank" itself is competition-style: a score's rank is `1 + the number of
 * STRICTLY better scores`, so genuine ties share the leading rank — matching
 * the `rankForScore` SQL in the store.
 */

import type { ScoreEntry, SortDir } from "@/sdk/src/contract";

/** A score row rich enough to reproduce the SQL tie-break in memory. */
export interface RankInput {
  handle: string;
  score: number;
  /** Epoch millis; earlier wins a score tie. Absent values sort last. */
  createdAt?: number;
  /** Identity column; lower wins once score and createdAt match. */
  id?: number;
}

/**
 * Build the comparator that orders rows for a board of the given `sort`.
 * Sorting an array with this yields rank order (best first).
 */
export function comparator(sort: SortDir): (a: RankInput, b: RankInput) => number {
  return (a, b) => {
    if (a.score !== b.score) {
      return sort === "asc" ? a.score - b.score : b.score - a.score;
    }
    const aCreated = a.createdAt ?? Number.POSITIVE_INFINITY;
    const bCreated = b.createdAt ?? Number.POSITIVE_INFINITY;
    if (aCreated !== bCreated) return aCreated - bCreated;
    const aId = a.id ?? Number.POSITIVE_INFINITY;
    const bId = b.id ?? Number.POSITIVE_INFINITY;
    return aId - bId;
  };
}

/**
 * Competition rank of `score` against an existing population of `scores`:
 * `1 + count of strictly-better scores`. For `desc`, "better" means greater;
 * for `asc`, "better" means smaller. Mirrors the store's `rankForScore` SQL.
 */
export function rankForScores(scores: number[], score: number, sort: SortDir): number {
  const better =
    sort === "asc"
      ? scores.filter((s) => s < score).length
      : scores.filter((s) => s > score).length;
  return better + 1;
}

/**
 * Order `entries` with {@link comparator} and project them to public
 * {@link ScoreEntry} rows with a positional `rank` (1..N). This is the pure
 * in-memory mirror of `store.getTopScores`, used by tests to lock the ordering.
 */
export function assignRanks(entries: RankInput[], sort: SortDir = "desc"): ScoreEntry[] {
  return [...entries]
    .sort(comparator(sort))
    .map((entry, index) => ({
      rank: index + 1,
      handle: entry.handle,
      score: entry.score,
    }));
}
