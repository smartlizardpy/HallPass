/**
 * The Fright Fest season filter at the HTTP edge. Both public leaderboard reads
 * (the per-board route every SDK integration uses, and the per-game route behind
 * the store page's panel) opt into the season, and the response BODY is exactly
 * the shape it always was: only which scores come back changes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getBoard: vi.fn(),
  getTopScores: vi.fn(),
  listBoardsForGame: vi.fn(),
  appendScore: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/scoreboard", () => ({
  store: {
    getBoard: h.getBoard,
    getTopScores: h.getTopScores,
    listBoardsForGame: h.listBoardsForGame,
    appendScore: h.appendScore,
  },
  sanitizeHandle: (s?: string) => s ?? "Anon",
  isValidScore: (n: unknown) => typeof n === "number",
  clientKeyFromHeaders: () => "ip",
  hashIp: () => "iphash",
  clampLimit: (n: number) => n,
  normalizePeriod: () => "all",
  createClaimToken: () => null,
  DEFAULT_LIMIT: 10,
  GAME_BOARD_MAX_BOARDS: 3,
  GAME_BOARD_ROWS: 5,
}));
vi.mock("@/app/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/app/lib/challenges", () => ({ resolveChallengesForScore: async () => [] }));
vi.mock("@/app/lib/challenges/notify", () => ({ notifyChallengesBeaten: async () => {} }));
vi.mock("@/app/lib/players", () => ({
  getPublicIdentity: async () => null,
  upsertPlayerOnLogin: async () => {},
}));
vi.mock("@/app/lib/games-store", () => ({
  isStagedOrUnverifiable: async () => false,
  isKnownSlug: async () => true,
  isStagedSlug: async () => false,
}));
vi.mock("@/app/lib/beta/staged-access", () => ({ canViewStaged: async () => false }));

import { GET, POST } from "@/app/api/v1/leaderboard/[slug]/route";
import { GET as GET_GAME } from "@/app/api/v1/games/[slug]/leaderboard/route";

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const board = {
  slug: "b1",
  gameSlug: "g",
  title: "Board",
  scoreLabel: "pts",
  sort: "desc",
  maxScore: null,
};
const rows = [{ rank: 1, handle: "Ann", score: 90, verified: false }];

beforeEach(() => {
  vi.clearAllMocks();
  h.getBoard.mockResolvedValue(board);
  h.getTopScores.mockResolvedValue(rows);
  h.listBoardsForGame.mockResolvedValue([board]);
  h.appendScore.mockResolvedValue({ ok: true, rank: 4, id: 1 });
});

describe("per-board GET", () => {
  it("reads the season and keeps the exact body and cache header", async () => {
    const res = await GET(new Request("http://x/?limit=5"), params("b1"));
    expect(h.getTopScores).toHaveBeenCalledWith("b1", {
      limit: 5,
      period: "all",
      sort: "desc",
      seasonal: true,
    });
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=15, stale-while-revalidate=45",
    );
    expect(await res.json()).toEqual({
      game: "b1",
      title: "Board",
      scoreLabel: "pts",
      sort: "desc",
      period: "all",
      scores: rows,
    });
  });
});

describe("per-game GET", () => {
  it("reads the season and keeps the exact body", async () => {
    const res = await GET_GAME(new Request("http://x/"), params("g"));
    expect(h.getTopScores).toHaveBeenCalledWith("b1", {
      limit: 5,
      period: "all",
      sort: "desc",
      seasonal: true,
    });
    expect(await res.json()).toEqual({
      slug: "g",
      period: "all",
      boards: [
        { boardId: "b1", title: "Board", scoreLabel: "pts", sort: "desc", scores: rows },
      ],
    });
  });
});

describe("POST", () => {
  it("still returns { ok, rank, handle, score } with the store's rank", async () => {
    const res = await POST(
      new Request("http://x/", { method: "POST", body: JSON.stringify({ score: 10 }) }),
      params("b1"),
    );
    expect(await res.json()).toEqual({ ok: true, rank: 4, handle: "Anon", score: 10 });
  });
});
