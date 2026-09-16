/**
 * Tests for the public game-board panel's model. Pure in, pure out — no fake
 * `sql`, no DOM. These are the assertions the island itself cannot carry, which
 * is the whole reason the logic was lifted out of it.
 */

import { describe, it, expect } from "vitest";
import type { ScoreEntry } from "@/sdk/src/contract";
import {
  buildGameBoards,
  isPodium,
  shouldNameBoards,
  type GameBoardPayload,
} from "./game-board";

/** A wire entry with everything defaulted but the fields a test cares about. */
function entry(over: Partial<ScoreEntry> & { score: number }): ScoreEntry {
  return { rank: 1, handle: "PLR", verified: false, ...over };
}

/** A board payload shaped like the endpoint's, with the scores a test supplies. */
function board(over: Partial<GameBoardPayload> = {}): GameBoardPayload {
  return {
    boardId: "neon-snake",
    title: "Neon Snake",
    scoreLabel: "Voltage",
    sort: "desc",
    scores: [],
    ...over,
  };
}

describe("buildGameBoards", () => {
  it("carries the board's identity and score label through untouched", () => {
    const boards = buildGameBoards([board({ scores: [entry({ score: 900 })] })]);

    expect(boards).toHaveLength(1);
    expect(boards[0].boardId).toBe("neon-snake");
    expect(boards[0].title).toBe("Neon Snake");
    expect(boards[0].scoreLabel).toBe("Voltage");
    expect(boards[0].sort).toBe("desc");
  });

  it("numbers rows 1, 2, 3 when every score is distinct", () => {
    const [built] = buildGameBoards([
      board({
        scores: [entry({ score: 900 }), entry({ score: 500 }), entry({ score: 100 })],
      }),
    ]);

    expect(built.rows.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(built.rows.map((r) => r.tied)).toEqual([false, false, false]);
  });

  it("gives tied scores the same position and skips the number they consumed", () => {
    const [built] = buildGameBoards([
      board({
        scores: [entry({ score: 900 }), entry({ score: 900 }), entry({ score: 100 })],
      }),
    ]);

    expect(built.rows.map((r) => r.position)).toEqual([1, 1, 3]);
    expect(built.rows.map((r) => r.tied)).toEqual([true, true, false]);
  });

  it("does not print the server's positional rank as a position", () => {
    // `getTopScores` numbers rows by index, so two equal scores arrive as 1 and
    // 2. Printing that would render a created_at/id tie-break as a result.
    const [built] = buildGameBoards([
      board({
        scores: [entry({ rank: 1, score: 900 }), entry({ rank: 2, score: 900 })],
      }),
    ]);

    expect(built.rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(built.rows.map((r) => r.position)).toEqual([1, 1]);
  });

  it("ties on an asc board exactly as on a desc one", () => {
    const [built] = buildGameBoards([
      board({
        sort: "asc",
        scoreLabel: "Seconds",
        scores: [entry({ score: 12 }), entry({ score: 12 }), entry({ score: 30 })],
      }),
    ]);

    expect(built.rows.map((r) => r.position)).toEqual([1, 1, 3]);
  });

  it("keeps the endpoint's row order rather than re-sorting it", () => {
    // The asc/desc decision was applied in SQL against the board's stored sort;
    // re-deriving it here would be a second implementation free to disagree.
    const [built] = buildGameBoards([
      board({
        sort: "asc",
        scores: [entry({ score: 12 }), entry({ score: 30 }), entry({ score: 99 })],
      }),
    ]);

    expect(built.rows.map((r) => r.score)).toEqual([12, 30, 99]);
  });

  it("drops a provisioned but unplayed board", () => {
    const boards = buildGameBoards([
      board({ scores: [] }),
      board({ boardId: "nv-time-attack", title: "Time Attack", scores: [entry({ score: 12 })] }),
    ]);

    expect(boards.map((b) => b.boardId)).toEqual(["nv-time-attack"]);
  });

  it("returns nothing at all when no board has a score", () => {
    expect(buildGameBoards([board(), board({ boardId: "nv-time-attack" })])).toEqual([]);
    expect(buildGameBoards([])).toEqual([]);
  });

  it("preserves the board order the endpoint served", () => {
    const boards = buildGameBoards([
      board({ boardId: "a", scores: [entry({ score: 1 })] }),
      board({ boardId: "b", scores: [entry({ score: 1 })] }),
      board({ boardId: "c", scores: [entry({ score: 1 })] }),
    ]);

    expect(boards.map((b) => b.boardId)).toEqual(["a", "b", "c"]);
  });

  it("keeps the verified flag and avatar a verified row carries", () => {
    const [built] = buildGameBoards([
      board({
        scores: [
          entry({ score: 900, handle: "Ada", verified: true, avatar: "https://x/a.png" }),
          entry({ score: 100, handle: "GUEST" }),
        ],
      }),
    ]);

    expect(built.rows[0].verified).toBe(true);
    expect(built.rows[0].avatar).toBe("https://x/a.png");
    expect(built.rows[1].verified).toBe(false);
    expect(built.rows[1].avatar).toBeUndefined();
  });
});

describe("buildGameBoards — marking the reader's own row", () => {
  const ME = "11111111-2222-3333-4444-555555555555";
  const THEM = "99999999-8888-7777-6666-555555555555";

  it("marks the row whose playerId is the reader's, and only that row", () => {
    const [built] = buildGameBoards(
      [
        board({
          scores: [
            entry({ score: 900, handle: "Them", verified: true, playerId: THEM }),
            entry({ score: 500, handle: "Me", verified: true, playerId: ME }),
            entry({ score: 100, handle: "GUEST" }),
          ],
        }),
      ],
      ME,
    );

    expect(built.rows.map((r) => r.isYou)).toEqual([false, true, false]);
  });

  it("marks the reader on every board they appear on", () => {
    const boards = buildGameBoards(
      [
        board({ scores: [entry({ score: 900, verified: true, playerId: ME })] }),
        board({
          boardId: "nv-time-attack",
          scores: [entry({ score: 12, verified: true, playerId: ME })],
        }),
      ],
      ME,
    );

    expect(boards.map((b) => b.rows[0].isYou)).toEqual([true, true]);
  });

  it("marks nothing for a signed-out reader, anonymous rows included", () => {
    // THE GUARD THAT MATTERS. A guest row has no playerId and a signed-out reader
    // has no id; comparing two absent values would mark every anonymous row on
    // the board as "you".
    const [built] = buildGameBoards(
      [
        board({
          scores: [entry({ score: 900 }), entry({ score: 500 }), entry({ score: 100 })],
        }),
      ],
      null,
    );

    expect(built.rows.map((r) => r.isYou)).toEqual([false, false, false]);
  });

  it("marks nothing when no viewer is supplied at all", () => {
    const [built] = buildGameBoards([
      board({ scores: [entry({ score: 900, verified: true, playerId: ME })] }),
    ]);

    expect(built.rows[0].isYou).toBe(false);
  });

  it("does not match on the display handle, which is not unique", () => {
    // Copying somebody's handle must not highlight their row as yours.
    const [built] = buildGameBoards(
      [
        board({
          scores: [entry({ score: 900, handle: "Me", verified: true, playerId: THEM })],
        }),
      ],
      ME,
    );

    expect(built.rows[0].isYou).toBe(false);
  });

  it("still marks the reader when they are tied with somebody else", () => {
    const [built] = buildGameBoards(
      [
        board({
          scores: [
            entry({ score: 900, verified: true, playerId: THEM }),
            entry({ score: 900, verified: true, playerId: ME }),
          ],
        }),
      ],
      ME,
    );

    expect(built.rows.map((r) => r.position)).toEqual([1, 1]);
    expect(built.rows.map((r) => r.isYou)).toEqual([false, true]);
  });
});

describe("shouldNameBoards", () => {
  it("stays quiet for a single board, whose title is the game's own name", () => {
    expect(shouldNameBoards(buildGameBoards([board({ scores: [entry({ score: 1 })] })]))).toBe(
      false,
    );
  });

  it("names them once there is more than one to tell apart", () => {
    const boards = buildGameBoards([
      board({ scores: [entry({ score: 1 })] }),
      board({ boardId: "nv-time-attack", scores: [entry({ score: 1 })] }),
    ]);

    expect(shouldNameBoards(boards)).toBe(true);
  });

  it("counts the boards that render, not the ones that were served", () => {
    const boards = buildGameBoards([
      board({ scores: [entry({ score: 1 })] }),
      board({ boardId: "nv-time-attack", scores: [] }),
    ]);

    expect(shouldNameBoards(boards)).toBe(false);
  });
});

describe("isPodium", () => {
  it("places the top three", () => {
    expect([1, 2, 3].map(isPodium)).toEqual([true, true, true]);
  });

  it("does not place the fourth", () => {
    expect(isPodium(4)).toBe(false);
  });

  it("places every member of a tie that holds a podium position", () => {
    // Four players tied at 1 all hold first place; the next distinct score is 5th.
    expect([1, 1, 1, 1].map(isPodium)).toEqual([true, true, true, true]);
    expect(isPodium(5)).toBe(false);
  });
});
