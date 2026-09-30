/**
 * A challenge or share link goes to somebody who may not be a tester, so a board
 * on a staged game is refused for EVERYONE — `no-board`, the answer of a board
 * that does not exist. The check uses the public resolver, so it fails closed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getBoard: vi.fn(),
  listBoardsForGame: vi.fn(),
  resolveGame: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/scoreboard", () => ({
  store: { getBoard: h.getBoard, listBoardsForGame: h.listBoardsForGame },
}));
vi.mock("@/app/lib/games-store", () => ({ resolveGame: h.resolveGame }));

import { resolveChallengeBoard } from "./board";

const board = (gameSlug: string | null) => ({ slug: "b1", gameSlug });

beforeEach(() => {
  vi.clearAllMocks();
  // Public resolver: only "live" is visible; "beta" (staged) resolves to undefined.
  h.resolveGame.mockImplementation(async (s: string) =>
    s === "live" ? { slug: "live" } : undefined,
  );
  h.getBoard.mockResolvedValue(board("live"));
  h.listBoardsForGame.mockResolvedValue([board("live")]);
});

describe("resolveChallengeBoard and staged games", () => {
  it("refuses an explicit board linked to a staged game", async () => {
    h.getBoard.mockResolvedValue(board("beta"));
    expect(await resolveChallengeBoard({ board: "b1" })).toEqual({ reason: "no-board" });
  });

  it("refuses a game-addressed board when the game is staged", async () => {
    h.getBoard.mockResolvedValue(board("beta"));
    h.listBoardsForGame.mockResolvedValue([board("beta")]);
    expect(await resolveChallengeBoard({ game: "beta" })).toEqual({ reason: "no-board" });
  });

  it("allows a board on a live game, and a standalone board", async () => {
    expect(await resolveChallengeBoard({ board: "b1" })).toEqual({ boardId: "b1" });
    h.getBoard.mockResolvedValue(board(null));
    expect(await resolveChallengeBoard({ board: "b1" })).toEqual({ boardId: "b1" });
  });

  it("leaves a board that does not exist to the caller's own statement", async () => {
    h.getBoard.mockResolvedValue(null);
    expect(await resolveChallengeBoard({ board: "ghost" })).toEqual({ boardId: "ghost" });
  });
});
