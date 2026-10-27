/**
 * BoardPass on the score route: a board player is credited ONLY when no Google
 * session exists and the board bound that player to THIS board's game. The score
 * row is tagged like a signed-in one, under the PUBLIC name.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getBoard: vi.fn(),
  appendScore: vi.fn(),
  auth: vi.fn(),
  gameplayPlayerId: vi.fn(),
  getBoardIdentity: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/scoreboard", () => ({
  store: { getBoard: h.getBoard, getTopScores: vi.fn(), appendScore: h.appendScore },
  sanitizeHandle: (s?: string) => s ?? "Anon",
  isValidScore: (n: unknown) => typeof n === "number",
  clientKeyFromHeaders: () => "ip",
  hashIp: () => "iphash",
  clampLimit: (n: number) => n,
  normalizePeriod: () => "all",
  createClaimToken: () => null,
  DEFAULT_LIMIT: 10,
}));
vi.mock("@/app/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/app/lib/challenges", () => ({ resolveChallengesForScore: async () => [] }));
vi.mock("@/app/lib/challenges/notify", () => ({ notifyChallengesBeaten: async () => {} }));
vi.mock("@/app/lib/players", () => ({
  getPublicIdentity: async () => ({ handle: "Google Name" }),
  upsertPlayerOnLogin: async () => {},
}));
vi.mock("@/app/lib/games-store", () => ({ isStagedOrUnverifiable: async () => false }));
vi.mock("@/app/lib/beta/staged-access", () => ({ canViewStaged: async () => false }));
vi.mock("@/app/lib/boardpass/resolve", () => ({ gameplayPlayerId: h.gameplayPlayerId }));
vi.mock("@/app/lib/boardpass/identity", () => ({ getBoardIdentity: h.getBoardIdentity }));

import { POST } from "@/app/api/v1/leaderboard/[slug]/route";

const post = () =>
  POST(
    new Request("http://x/", { method: "POST", body: JSON.stringify({ score: 10 }) }),
    { params: Promise.resolve({ slug: "b1" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.getBoard.mockResolvedValue({
    slug: "b1", gameSlug: "duskfall", title: "B", scoreLabel: "pts", sort: "desc", maxScore: null,
  });
  h.appendScore.mockResolvedValue({ ok: true, rank: 1, id: 1 });
  h.auth.mockResolvedValue(null);
  h.gameplayPlayerId.mockResolvedValue(null);
  h.getBoardIdentity.mockResolvedValue({ handle: "ozan_public" });
});

describe("board player credit", () => {
  it("credits the chosen player under their PUBLIC name, resolved for the board's game", async () => {
    h.gameplayPlayerId.mockResolvedValue("player-ozan");
    expect((await post()).status).toBe(200);
    expect(h.gameplayPlayerId).toHaveBeenCalledWith("duskfall");
    expect(h.appendScore).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({ playerId: "player-ozan", handle: "ozan_public" }),
      expect.anything(),
    );
  });

  it("a Google session wins and the board resolver is never consulted", async () => {
    h.auth.mockResolvedValue({ user: { playerId: "google-p", email: "a@b.c", name: "G" } });
    await post();
    expect(h.gameplayPlayerId).not.toHaveBeenCalled();
    expect(h.appendScore).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({ playerId: "google-p" }),
      expect.anything(),
    );
  });

  it("stays anonymous when no player is bound to this game", async () => {
    expect((await post()).status).toBe(200);
    expect(h.appendScore).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({ playerId: null }),
      expect.anything(),
    );
  });

  it("a standalone board (no game) never asks the resolver", async () => {
    h.getBoard.mockResolvedValue({
      slug: "b1", gameSlug: null, title: "B", scoreLabel: "pts", sort: "desc", maxScore: null,
    });
    await post();
    expect(h.gameplayPlayerId).not.toHaveBeenCalled();
  });
});
