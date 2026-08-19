/**
 * HallPass — the friends-panel MODEL: pure, sorted rows in, grouped rows out.
 *
 * Extracted from `components/friends/FriendsBoard.tsx` for the reason
 * `lib/streak/core.ts` gives for the same split: the island is a fetch and some
 * markup, and everything about it worth being wrong is in here. `vitest.config.ts`
 * only collects `*.test.ts`, and this repo has no component test harness, so
 * logic left inside a `.tsx` is logic that cannot be tested at all.
 *
 * No `server-only`, no database, no clock, no DOM — the route and the island both
 * import it, so what the panel counts cannot drift from what the endpoint served.
 *
 * ── THE ONE JUDGEMENT IN HERE: TIES ────────────────────────────────────────
 * Two friends can hold the same best. Numbering them 1 and 2 asserts an order
 * the board does not have, and picking which one goes on top would be a coin
 * flip rendered as a fact. So equal bests share a position (1, 1, 3 — competition
 * numbering, the same shape as the rank the server computes) and both are marked
 * `tied`, which is what lets the UI print "=1" instead of inventing a winner.
 */

import type { FriendStanding } from "./store";

/** One row of a board group: a standing, plus where it sits among friends. */
export interface FriendBoardRow extends FriendStanding {
  /** Competition position within the friend set: 1, 1, 3 — never 1, 2, 3 on a tie. */
  position: number;
  /** True when at least one other row on this board holds the same best. */
  tied: boolean;
}

/** One board's worth of rows, in the order the server returned them. */
export interface FriendBoardGroup {
  boardId: string;
  title: string;
  rows: FriendBoardRow[];
}

/**
 * Group standings by board, preserving the server's order and numbering each
 * board's rows.
 *
 * The endpoint already returns boards in their stable `created_at ASC, id ASC`
 * order with each board's rows contiguous and best-first, so a `Map` reproduces
 * that without a second sort — and deliberately does NOT re-sort, because the
 * asc/desc decision belongs to the board's stored `sort` and was already applied
 * in SQL. Re-deriving it here from `sort` would be a second implementation of
 * the same rule, free to disagree with the first.
 */
export function groupFriendStandings(standings: FriendStanding[]): FriendBoardGroup[] {
  const groups = new Map<string, FriendStanding[]>();
  for (const row of standings) {
    const rows = groups.get(row.boardId);
    if (rows) rows.push(row);
    else groups.set(row.boardId, [row]);
  }

  return [...groups.entries()].map(([boardId, rows]) => ({
    boardId,
    title: rows[0].boardTitle,
    rows: numberRows(rows),
  }));
}

/**
 * Competition-number one board's rows and flag the ties.
 *
 * A row's position is the index of the FIRST row holding its `best`, so equal
 * scores share a number and the next distinct score skips past them. Comparing
 * against the previous row alone is enough because the input is already ordered
 * by `best` — the invariant the docblock above relies on.
 */
function numberRows(rows: FriendStanding[]): FriendBoardRow[] {
  const positions: number[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    positions.push(i > 0 && rows[i].best === rows[i - 1].best ? positions[i - 1] : i + 1);
  }
  return rows.map((row, i) => ({
    ...row,
    position: positions[i],
    tied:
      (i > 0 && rows[i - 1].best === row.best) ||
      (i < rows.length - 1 && rows[i + 1].best === row.best),
  }));
}

/**
 * Whether a group's board title is worth printing.
 *
 * A single board's title is nearly always the game's own name, so printing it
 * under a heading that already names the game says the same word twice. It earns
 * its place only when there is more than one board to tell apart.
 */
export function shouldNameBoards(groups: FriendBoardGroup[]): boolean {
  return groups.length > 1;
}

/**
 * What, if anything, the panel should say to a player standing alone on it.
 *
 *   `none`          there is a race on — at least one row is somebody else's —
 *                   or there is nothing at all, in which case the panel does not
 *                   render and has nowhere to put a prompt anyway.
 *   `add-friends`   the player has a score here and has added nobody. The one
 *                   moment this site can ask for that with a straight face:
 *                   they have just proved they play this game.
 *   `nudge-friends` they have friends, and none of those friends has a score on
 *                   this game. "Add friends" would be wrong advice; the thing to
 *                   do is dare the friends they already have.
 *
 * The distinction cannot be drawn from the standings alone — both empty cases
 * arrive as "no row but mine" — which is why the endpoint pays for a friend
 * count in exactly that case and no other.
 *
 * Deliberately NOT shown to a player with no score of their own. A prompt on a
 * page they have not played yet is an ask before a reason, and `FeaturePromo`
 * already documents what this codebase thinks of spending an ask that way.
 */
export type FriendBoardPrompt = "none" | "add-friends" | "nudge-friends";

export function promptFor(
  groups: FriendBoardGroup[],
  friendCount: number,
): FriendBoardPrompt {
  const rows = groups.flatMap((group) => group.rows);
  if (rows.length === 0) return "none";
  if (rows.some((row) => !row.isYou)) return "none";
  return friendCount > 0 ? "nudge-friends" : "add-friends";
}
