/**
 * Staged gating on the per-game leaderboard and achievements routes.
 *
 * The leaderboard panel is identity-free on purpose: a staged slug answers an
 * empty `no-store` body and the route must never reach `auth()`. Achievements
 * gate GET (empty + no-store for a stranger, private for a tester) and POST
 * (testers may earn; everyone else gets the unknown-game 404). Ordinary games
 * keep their headers and never touch the gate.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listBoardsForGame: vi.fn(),
  getTopScores: vi.fn(),
  isKnownSlug: vi.fn(),
  isStagedSlug: vi.fn(),
  canViewStaged: vi.fn(),
  currentPlayerId: vi.fn(),
  getPlayerAchievements: vi.fn(),
  recordAchievements: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/scoreboard", () => ({
  store: { listBoardsForGame: h.listBoardsForGame, getTopScores: h.getTopScores },
  GAME_BOARD_MAX_BOARDS: 3,
  GAME_BOARD_ROWS: 5,
}));
vi.mock("@/app/lib/db", () => ({ isMissingColumnError: () => false }));
vi.mock("@/app/lib/games-store", () => ({
  isKnownSlug: h.isKnownSlug,
  isStagedSlug: h.isStagedSlug,
}));
vi.mock("@/app/lib/beta/staged-access", () => ({ canViewStaged: h.canViewStaged }));
vi.mock("@/app/lib/achievements", () => ({
  getAchievementCatalogue: async () => [],
  getAchievementRarity: async () => ({}),
  getPlayerAchievements: h.getPlayerAchievements,
  recordAchievements: h.recordAchievements,
}));
vi.mock("@/app/lib/achievements/config", () => ({
  ACHIEVEMENT_PLAYER_RATE_LIMIT: { windowSeconds: 60 },
  MAX_BATCH_SIZE: 10,
}));
vi.mock("@/app/lib/notifications/copy", () => ({ achievementCopy: () => ({}) }));
vi.mock("@/app/lib/notifications/deliver", () => ({ notifyPlayer: async () => {} }));
vi.mock("@/app/lib/social/request-guard", () => ({
  NO_STORE: { "Cache-Control": "private, no-store" },
  currentPlayerId: h.currentPlayerId,
  credentialedOptions: () => new Response(null, { status: 204 }),
}));

import * as leaderboard from "@/app/api/v1/games/[slug]/leaderboard/route";
import * as achievements from "@/app/api/v1/games/[slug]/achievements/route";

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const PUBLIC = "public, s-maxage=15, stale-while-revalidate=45";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.listBoardsForGame.mockResolvedValue([]);
  h.getTopScores.mockResolvedValue([]);
  h.isKnownSlug.mockResolvedValue(true);
  h.isStagedSlug.mockResolvedValue(false);
  h.canViewStaged.mockResolvedValue(false);
  h.currentPlayerId.mockResolvedValue(null);
  h.getPlayerAchievements.mockResolvedValue({
    achievements: [{ key: "a" }],
    earnedPoints: 5,
    totalPoints: 10,
  });
  h.recordAchievements.mockResolvedValue({ ok: true, results: [] });
});

describe("GET /games/[slug]/leaderboard", () => {
  it("keeps the public cache header for an ordinary game", async () => {
    const res = await leaderboard.GET(new Request("http://x/"), params("pub"));
    expect(res.headers.get("Cache-Control")).toBe(PUBLIC);
    expect(h.listBoardsForGame).toHaveBeenCalledWith("pub");
    expect(h.canViewStaged).not.toHaveBeenCalled();
  });

  it("returns an empty no-store body for a staged game, with no gate and no query", async () => {
    h.isStagedSlug.mockResolvedValue(true);
    const res = await leaderboard.GET(new Request("http://x/"), params("beta"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ slug: "beta", period: "all", boards: [] });
    expect(h.listBoardsForGame).not.toHaveBeenCalled();
    expect(h.canViewStaged).not.toHaveBeenCalled();
  });
});

describe("GET /games/[slug]/achievements", () => {
  it("keeps the guest public cache for an ordinary game", async () => {
    const res = await achievements.GET(new Request("http://x/"), params("pub"));
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=30");
    expect(h.canViewStaged).not.toHaveBeenCalled();
  });

  it("gives a stranger the empty shelf of an unknown game, no-store", async () => {
    h.isStagedSlug.mockResolvedValue(true);
    const res = await achievements.GET(new Request("http://x/"), params("beta"));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ achievements: [], totalPoints: 0 });
    expect(h.getPlayerAchievements).not.toHaveBeenCalled();
  });

  it("gives a tester the real shelf, private even when they are the only reader", async () => {
    h.isStagedSlug.mockResolvedValue(true);
    h.canViewStaged.mockResolvedValue(true);
    const res = await achievements.GET(new Request("http://x/"), params("beta"));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Cache-Control")).not.toMatch(/public|s-maxage/);
    expect(await res.json()).toMatchObject({ totalPoints: 10 });
  });
});

describe("POST /games/[slug]/achievements", () => {
  const post = (slug: string) =>
    achievements.POST(
      new Request("http://x/", { method: "POST", body: JSON.stringify({ unlock: "a" }) }),
      params(slug),
    );

  beforeEach(() => h.currentPlayerId.mockResolvedValue("p1"));

  it("records on an ordinary game without the gate", async () => {
    const res = await post("pub");
    expect(res.status).toBe(200);
    expect(h.canViewStaged).not.toHaveBeenCalled();
  });

  it("404s an unknown slug", async () => {
    h.isKnownSlug.mockResolvedValue(false);
    expect((await post("nope")).status).toBe(404);
  });

  it("404s a staged game for a non-tester, identically, and records nothing", async () => {
    h.isStagedSlug.mockResolvedValue(true);
    const res = await post("beta");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, reason: "no-game" });
    expect(h.recordAchievements).not.toHaveBeenCalled();
  });

  it("lets a tester earn on a staged game", async () => {
    h.isStagedSlug.mockResolvedValue(true);
    h.canViewStaged.mockResolvedValue(true);
    expect((await post("beta")).status).toBe(200);
    expect(h.recordAchievements).toHaveBeenCalledTimes(1);
  });
});
