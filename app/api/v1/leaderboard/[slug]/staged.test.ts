/**
 * Staged boards on the per-board route: a board linked to a staged game is
 * withheld from the public (the "Board not initialized" answer of a board that
 * does not exist, plus `no-store`), served to testers with `private, no-store`,
 * and a PUBLIC board keeps today's headers and never touches the session gate.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getBoard: vi.fn(),
  getTopScores: vi.fn(),
  appendScore: vi.fn(),
  isStagedSlug: vi.fn(),
  canViewStaged: vi.fn(),
  auth: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/scoreboard", () => ({
  store: {
    getBoard: h.getBoard,
    getTopScores: h.getTopScores,
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
}));
vi.mock("@/app/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/app/lib/challenges", () => ({ resolveChallengesForScore: async () => [] }));
vi.mock("@/app/lib/challenges/notify", () => ({ notifyChallengesBeaten: async () => {} }));
vi.mock("@/app/lib/players", () => ({
  getPublicIdentity: async () => null,
  upsertPlayerOnLogin: async () => {},
}));
vi.mock("@/app/lib/games-store", () => ({ isStagedSlug: h.isStagedSlug }));
vi.mock("@/app/lib/beta/staged-access", () => ({ canViewStaged: h.canViewStaged }));

import { GET, POST } from "@/app/api/v1/leaderboard/[slug]/route";

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const get = (slug: string) => GET(new Request("http://x/?limit=5"), params(slug));
const post = (slug: string) =>
  POST(
    new Request("http://x/", { method: "POST", body: JSON.stringify({ score: 10 }) }),
    params(slug),
  );

const board = (gameSlug: string | null) => ({
  slug: "b1",
  gameSlug,
  title: "Board",
  scoreLabel: "pts",
  sort: "desc",
  maxScore: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.getTopScores.mockResolvedValue([]);
  h.appendScore.mockResolvedValue({ ok: true, rank: 1, id: 1 });
  h.auth.mockResolvedValue(null);
  h.isStagedSlug.mockResolvedValue(false);
  h.canViewStaged.mockResolvedValue(false);
});

describe("public boards are unchanged", () => {
  it("GET keeps the public s-maxage header and never asks canViewStaged", async () => {
    h.getBoard.mockResolvedValue(board("pub-game"));
    const res = await get("b1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=15, stale-while-revalidate=45",
    );
    expect(h.canViewStaged).not.toHaveBeenCalled();
  });

  it("a standalone board skips the catalogue lookup entirely", async () => {
    h.getBoard.mockResolvedValue(board(null));
    const res = await get("b1");
    expect(res.status).toBe(200);
    expect(h.isStagedSlug).not.toHaveBeenCalled();
    expect(h.canViewStaged).not.toHaveBeenCalled();
  });

  it("POST records the score without the staged gate", async () => {
    h.getBoard.mockResolvedValue(board("pub-game"));
    const res = await post("b1");
    expect(res.status).toBe(200);
    expect(h.canViewStaged).not.toHaveBeenCalled();
  });
});

describe("a staged board", () => {
  beforeEach(() => {
    h.getBoard.mockResolvedValue(board("beta-game"));
    h.isStagedSlug.mockResolvedValue(true);
  });

  it("is indistinguishable from a missing board to the public, and no-store", async () => {
    const staged = await get("b1");
    h.getBoard.mockResolvedValue(null);
    const missing = await get("nope");
    expect(staged.status).toBe(missing.status);
    expect(await staged.json()).toEqual(await missing.json());
    expect(staged.headers.get("Cache-Control")).toBe("private, no-store");
    expect(h.getTopScores).not.toHaveBeenCalled();
  });

  it("is byte-identical to an unprovisioned board: status, body and every header", async () => {
    const staged = await get("b1");
    h.getBoard.mockResolvedValue(null);
    const unknown = await get("nope");
    expect(staged.status).toBe(unknown.status);
    expect(await staged.text()).toBe(await unknown.text());
    expect([...staged.headers].sort()).toEqual([...unknown.headers].sort());
    expect(unknown.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("refuses a public POST and records nothing", async () => {
    const res = await post("b1");
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(h.appendScore).not.toHaveBeenCalled();
  });

  it("serves a tester's GET with private, no-store and never a public header", async () => {
    h.canViewStaged.mockResolvedValue(true);
    const res = await get("b1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Cache-Control")).not.toMatch(/public|s-maxage/);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("accepts a tester's POST", async () => {
    h.canViewStaged.mockResolvedValue(true);
    const res = await post("b1");
    expect(res.status).toBe(200);
    expect(h.appendScore).toHaveBeenCalledTimes(1);
  });
});
