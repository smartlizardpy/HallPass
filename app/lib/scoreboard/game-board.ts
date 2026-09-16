/**
 * HallPass — the PUBLIC game-board panel's MODEL: wire rows in, rows to render out.
 *
 * The sibling of `friend-board.ts`, split out of the island for the same reason
 * that one gives: `vitest.config.ts` only collects `*.test.ts` and this repo has
 * no component test harness, so logic left inside a `.tsx` is logic that cannot
 * be tested at all. The island is a fetch and some markup; everything in here is
 * a decision that can be wrong.
 *
 * No `server-only`, no database, no clock, no DOM — the route handler and the
 * island both import it, so what the panel prints cannot drift from what the
 * endpoint served.
 *
 * ── WHY THE SERVER'S `rank` IS NOT PRINTED ─────────────────────────────────
 * `store.getTopScores` numbers its rows POSITIONALLY: the returned `rank` is the
 * row's index + 1, so two players holding the same best come back as 1 and 2.
 * That is the right thing for the wire (a game asking "am I on the board" wants a
 * row number) and the wrong thing to print, for exactly the reason
 * `friend-board.ts` writes out about the friends panel: the order between equal
 * scores is decided by a `created_at`/`id` tie-break the reader cannot see, and
 * rendering it as 1st and 2nd shows a coin flip as a fact.
 *
 * So the panel re-numbers competition-style — 1, 1, 3 — and marks both rows
 * `tied`, which is what lets it print "=1". The two surfaces on this page then
 * agree with each other, which matters more than either agreeing with the index.
 */

import type { ScoreEntry, SortDir } from "@/sdk/src/contract";

/** One board's rows as the endpoint serves them, before numbering. */
export interface GameBoardPayload {
  boardId: string;
  title: string;
  scoreLabel: string;
  sort: SortDir;
  /** Best-first, already ordered and capped by the store's whitelisted SQL. */
  scores: ScoreEntry[];
}

/** One row: a score entry plus where it stands once ties are honoured. */
export interface GameBoardRow extends ScoreEntry {
  /** Competition position: 1, 1, 3 — never 1, 2, 3 on a tie. */
  position: number;
  /** True when at least one other row on this board holds the same score. */
  tied: boolean;
}

/** One board's worth of rows, in the order the endpoint returned them. */
export interface GameBoard {
  boardId: string;
  title: string;
  scoreLabel: string;
  sort: SortDir;
  rows: GameBoardRow[];
}

/**
 * Number each board's rows and drop the boards that have none.
 *
 * AN EMPTY BOARD IS NOT A BOARD, as far as this panel is concerned. A game whose
 * board is provisioned but unplayed would otherwise render a titled, ruled,
 * entirely empty table on a page whose job is to get somebody playing — and with
 * several boards, one empty one would sit between two populated ones looking
 * broken rather than new. Dropping them here (rather than in the endpoint) keeps
 * the wire body a faithful report of what boards exist.
 *
 * The order is the endpoint's and is NOT re-sorted: whether a board counts up or
 * down lives in its stored `sort` and was applied in SQL, so re-deriving it here
 * would be a second implementation of the same rule, free to disagree with the
 * first.
 */
export function buildGameBoards(payloads: GameBoardPayload[]): GameBoard[] {
  return payloads
    .filter((payload) => payload.scores.length > 0)
    .map((payload) => ({
      boardId: payload.boardId,
      title: payload.title,
      scoreLabel: payload.scoreLabel,
      sort: payload.sort,
      rows: numberRows(payload.scores),
    }));
}

/**
 * Competition-number one board's rows and flag the ties.
 *
 * A row's position is the position of the FIRST row holding its score, so equal
 * scores share a number and the next distinct score skips past them. Comparing
 * against the previous row alone is enough because the input is already ordered
 * by score — the invariant the module docblock relies on, and the one the store's
 * six whitelisted SELECT templates guarantee.
 */
function numberRows(scores: ScoreEntry[]): GameBoardRow[] {
  const positions: number[] = [];
  for (let i = 0; i < scores.length; i += 1) {
    positions.push(
      i > 0 && scores[i].score === scores[i - 1].score ? positions[i - 1] : i + 1,
    );
  }
  return scores.map((score, i) => ({
    ...score,
    position: positions[i],
    tied:
      (i > 0 && scores[i - 1].score === score.score) ||
      (i < scores.length - 1 && scores[i + 1].score === score.score),
  }));
}

/**
 * Whether a board's title is worth printing.
 *
 * Verbatim the judgement `friend-board.ts` makes, and deliberately its own
 * function rather than a shared generic one: a single board's title is nearly
 * always the game's own name, so printing it under a heading on the game's own
 * page says the same word twice. It earns its place only when there is more than
 * one board to tell apart.
 */
export function shouldNameBoards(boards: GameBoard[]): boolean {
  return boards.length > 1;
}

/**
 * Whether a position deserves the podium treatment.
 *
 * Three, because that is what a podium is, and it is a rule rather than a
 * hardcoded `<= 3` in the markup so the tie semantics above cannot be lost in
 * translation: two players tied at 1 and one at 3 all place, and four players
 * tied at 1 all place, which is correct — they genuinely all hold the position.
 */
export function isPodium(position: number): boolean {
  return position <= 3;
}
