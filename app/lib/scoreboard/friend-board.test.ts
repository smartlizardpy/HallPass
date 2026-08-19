/**
 * Tests for the friends-panel model. Pure in, pure out — no fake `sql`, no DOM.
 * These are the assertions the island itself cannot carry, which is the whole
 * reason the logic was lifted out of it.
 */

import { describe, it, expect } from "vitest";
import {
  canChallengeFrom,
  groupFriendStandings,
  promptFor,
  shouldNameBoards,
} from "./friend-board";
import type { FriendStanding } from "./store";

/** A standing with everything defaulted but the fields a test cares about. */
function standing(over: Partial<FriendStanding> & { best: number }): FriendStanding {
  return {
    boardId: "neon-snake",
    boardTitle: "Neon Snake",
    scoreLabel: "Voltage",
    sort: "desc",
    isYou: false,
    player: {
      id: `p-${over.best}-${over.isYou ? "you" : "them"}`,
      username: null,
      displayName: "Player",
      image: null,
    },
    rank: 1,
    ...over,
  };
}

describe("groupFriendStandings", () => {
  it("keeps the server's board order and its rows together", () => {
    const groups = groupFriendStandings([
      standing({ best: 900 }),
      standing({ best: 500 }),
      standing({ boardId: "nv-time-attack", boardTitle: "Time Attack", best: 12 }),
    ]);

    expect(groups.map((g) => g.boardId)).toEqual(["neon-snake", "nv-time-attack"]);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[1].title).toBe("Time Attack");
  });

  it("numbers rows 1, 2, 3 when every best is distinct", () => {
    const groups = groupFriendStandings([
      standing({ best: 900 }),
      standing({ best: 500 }),
      standing({ best: 100 }),
    ]);

    expect(groups[0].rows.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(groups[0].rows.map((r) => r.tied)).toEqual([false, false, false]);
  });

  it("gives tied bests the same position and skips the number they consumed", () => {
    const groups = groupFriendStandings([
      standing({ best: 900 }),
      standing({ best: 900, isYou: true }),
      standing({ best: 100 }),
    ]);

    // Competition numbering: 1, 1, 3 — never 1, 2, 3, which would assert an
    // order between two equal scores that the board does not have.
    expect(groups[0].rows.map((r) => r.position)).toEqual([1, 1, 3]);
    expect(groups[0].rows.map((r) => r.tied)).toEqual([true, true, false]);
  });

  it("marks a tie at the bottom of a board too", () => {
    const groups = groupFriendStandings([
      standing({ best: 900 }),
      standing({ best: 100 }),
      standing({ best: 100 }),
    ]);

    expect(groups[0].rows.map((r) => r.position)).toEqual([1, 2, 2]);
    expect(groups[0].rows.map((r) => r.tied)).toEqual([false, true, true]);
  });

  it("numbers each board independently", () => {
    const groups = groupFriendStandings([
      standing({ best: 900 }),
      standing({ best: 900 }),
      standing({ boardId: "nv-time-attack", boardTitle: "Time Attack", sort: "asc", best: 12 }),
    ]);

    expect(groups[0].rows.map((r) => r.position)).toEqual([1, 1]);
    expect(groups[1].rows.map((r) => r.position)).toEqual([1]);
    expect(groups[1].rows[0].tied).toBe(false);
  });

  it("never re-sorts: an asc board arrives smallest-first and stays that way", () => {
    // The asc/desc decision was made in SQL from the board's stored `sort`.
    // Re-deriving it here would be a second implementation free to disagree.
    const groups = groupFriendStandings([
      standing({ sort: "asc", best: 12 }),
      standing({ sort: "asc", best: 30 }),
    ]);

    expect(groups[0].rows.map((r) => r.best)).toEqual([12, 30]);
    expect(groups[0].rows.map((r) => r.position)).toEqual([1, 2]);
  });

  it("returns nothing for nothing", () => {
    expect(groupFriendStandings([])).toEqual([]);
  });
});

describe("shouldNameBoards", () => {
  it("stays quiet for a single board, whose title repeats the game's name", () => {
    expect(shouldNameBoards(groupFriendStandings([standing({ best: 1 })]))).toBe(false);
  });

  it("names them once there is more than one to tell apart", () => {
    const groups = groupFriendStandings([
      standing({ best: 900 }),
      standing({ boardId: "nv-time-attack", boardTitle: "Time Attack", best: 12 }),
    ]);
    expect(shouldNameBoards(groups)).toBe(true);
  });
});

describe("promptFor", () => {
  const alone = groupFriendStandings([standing({ best: 900, isYou: true })]);

  it("says nothing when somebody else is on the board — that is a race already", () => {
    const race = groupFriendStandings([
      standing({ best: 900, isYou: true }),
      standing({ best: 500 }),
    ]);
    expect(promptFor(race, 0)).toBe("none");
    expect(promptFor(race, 12)).toBe("none");
  });

  it("asks a lone scorer with no friends to add some", () => {
    expect(promptFor(alone, 0)).toBe("add-friends");
  });

  it("nudges a lone scorer who already has friends, rather than misadvising them", () => {
    expect(promptFor(alone, 3)).toBe("nudge-friends");
  });

  it("says nothing at all when the player has no score of their own", () => {
    // No rows means no panel; there is nowhere to put a prompt, and asking
    // before they have played is an ask without a reason.
    expect(promptFor([], 0)).toBe("none");
    expect(promptFor([], 9)).toBe("none");
  });
});

describe("canChallengeFrom", () => {
  it("allows a challenge from a board the viewer is on", () => {
    const [group] = groupFriendStandings([
      standing({ best: 900 }),
      standing({ best: 500, isYou: true }),
    ]);
    expect(canChallengeFrom(group)).toBe(true);
  });

  it("refuses one from a board the viewer has never scored on", () => {
    // The route would answer `no-score`, correctly. A button that can only be
    // refused should not be on screen — the same argument `ChallengeButton`
    // makes about the standings list it was written for.
    const [group] = groupFriendStandings([standing({ best: 900 })]);
    expect(canChallengeFrom(group)).toBe(false);
  });

  it("is decided per board, not per panel", () => {
    const groups = groupFriendStandings([
      standing({ best: 900, isYou: true }),
      standing({ boardId: "nv-time-attack", boardTitle: "Time Attack", best: 12 }),
    ]);
    expect(groups.map(canChallengeFrom)).toEqual([true, false]);
  });
});
