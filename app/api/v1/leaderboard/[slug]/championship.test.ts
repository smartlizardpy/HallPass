/**
 * Championship boards on the leaderboard route: handed to the championship
 * intake before `boards`/`scores` are touched, signed-in and same-origin only,
 * and a public GET in the ordinary leaderboard shape with public ids only.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const OPEN_MS = Date.parse("2026-10-28T00:00:00Z") + 3_600_000;

const h = vi.hoisted(() => ({
  getBoard: vi.fn(),
  getTopScores: vi.fn(),
  appendScore: vi.fn(),
  auth: vi.fn(),
  readEvent: vi.fn(),
  issueToken: vi.fn(),
  findRun: vi.fn(),
  completeRun: vi.fn(),
  bestRuns: vi.fn(),
  getPublicChampionship: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/scoreboard", () => ({
  store: { getBoard: h.getBoard, getTopScores: h.getTopScores, appendScore: h.appendScore },
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
vi.mock("@/app/lib/players", () => ({ getPublicIdentity: async () => null, upsertPlayerOnLogin: async () => {} }));
vi.mock("@/app/lib/games-store", () => ({ isStagedOrUnverifiable: async () => false }));
vi.mock("@/app/lib/beta/staged-access", () => ({ canViewStaged: async () => false }));
vi.mock("@/app/lib/championship", () => ({
  championshipStore: {
    readEvent: h.readEvent,
    issueToken: h.issueToken,
    findRun: h.findRun,
    completeRun: h.completeRun,
    bestRuns: h.bestRuns,
  },
  getPublicChampionship: h.getPublicChampionship,
}));

import { GET, POST } from "@/app/api/v1/leaderboard/[slug]/route";
import { POST as RUNS } from "@/app/api/v1/leaderboard/[slug]/runs/route";
import { hashToken } from "@/app/lib/championship/intake";

const BOARD = "last-bell-halloween-shift";
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const req = (body: unknown, origin?: string) =>
  new Request("https://hallpass.games/api/v1/leaderboard/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
const signedIn = () => h.auth.mockResolvedValue({ user: { playerId: "g-123", email: "kid@school" } });
const snapshot = () => ({
  state: { status: "scheduled", suspended: false, suspendedReason: null, closedEarlyAt: null, finalisedAt: null },
  games: [{ slug: "last-bell", status: "open", openedAt: "2026-10-28T00:00:00Z" }],
  nowMs: OPEN_MS,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue(null);
  h.readEvent.mockResolvedValue(snapshot());
});

describe("POST to a championship board", () => {
  it("never touches the ordinary scoreboard", async () => {
    signedIn();
    await POST(req({ score: 300 }), params(BOARD));
    expect(h.getBoard).not.toHaveBeenCalled();
    expect(h.appendScore).not.toHaveBeenCalled();
  });

  it("asks a signed-out player to sign in, uncached and without wildcard CORS", async () => {
    const res = await POST(req({ score: 300, meta: {} }), params(BOARD));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ reason: "signed-out", championship: "fright-fest-2026" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses a cross-site request before reading the session", async () => {
    signedIn();
    const res = await POST(req({ score: 300 }, "https://evil.example"), params(BOARD));
    expect(res.status).toBe(403);
    expect(h.auth).not.toHaveBeenCalled();
    const same = await POST(req({ score: 300, meta: {} }, "https://hallpass.games"), params(BOARD));
    expect(same.status).toBe(409); // no run token: same-origin passes the origin check
  });

  it("records a run with a valid token and answers with the rank", async () => {
    signedIn();
    const token = "A".repeat(43);
    h.findRun.mockResolvedValue({
      id: 7, status: "issued", seed: 2026118, issuedAt: new Date(OPEN_MS - 200_000).toISOString(), expired: false,
      elapsedSec: 200, nowMs: OPEN_MS, score: null, tiebreak: null, flags: [], reason: null, submittedAt: null,
    });
    h.completeRun.mockResolvedValue({ id: 7, status: "accepted", submittedAt: new Date(OPEN_MS).toISOString() });
    h.bestRuns.mockResolvedValue([
      { runId: 7, gameSlug: "last-bell", playerId: "g-123", publicId: "pub", name: "@kid", avatar: "", score: 300, tiebreak: 180.4, submittedAt: new Date(OPEN_MS).toISOString() },
    ]);
    const res = await POST(
      req({ score: 300, meta: { event: "fright-fest-2026", seed: 2026118, time: 180.4, wall: 181, bound: 40, flags: [], token } }),
      params(BOARD),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true, championship: "fright-fest-2026", status: "accepted", rank: 1, best: true, late: false, duplicate: false, score: 300,
    });
    expect(h.findRun).toHaveBeenCalledWith(expect.objectContaining({ tokenHash: hashToken(token), playerId: "g-123" }));
    expect(h.completeRun.mock.calls[0][0].meta).not.toHaveProperty("token");
  });

  it("explains a rejected run", async () => {
    signedIn();
    h.findRun.mockResolvedValue({
      id: 8, status: "issued", seed: 2026118, issuedAt: new Date(OPEN_MS - 10_000).toISOString(), expired: false,
      elapsedSec: 10, nowMs: OPEN_MS, score: null, tiebreak: null, flags: [], reason: null, submittedAt: null,
    });
    h.completeRun.mockResolvedValue({ id: 8, status: "rejected", submittedAt: new Date(OPEN_MS).toISOString() });
    const res = await POST(req({ score: 300, meta: { event: "fright-fest-2026", seed: 2026118, time: 180, token: "B".repeat(43) } }), params(BOARD));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: "rejected", detail: "clock-faster-than-real-time" });
  });

  it("is unavailable, not an error, when the championship tables are missing", async () => {
    signedIn();
    h.readEvent.mockRejectedValue(Object.assign(new Error('relation "championship_events" does not exist'), { code: "42P01" }));
    const res = await POST(req({ score: 300, meta: { token: "C".repeat(43) } }), params(BOARD));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "unavailable" });
  });
});

describe("run start", () => {
  it("issues a token to a signed-in player and stores only its hash", async () => {
    signedIn();
    h.issueToken.mockResolvedValue({ runId: 1, issuedAt: new Date(OPEN_MS).toISOString(), expiresAt: new Date(OPEN_MS + 2_700_000).toISOString() });
    const res = await RUNS(req({ seed: 2026118 }), params(BOARD));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ board: BOARD, championship: "fright-fest-2026" });
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = h.issueToken.mock.calls[0][0];
    expect(stored).toMatchObject({ playerId: "g-123", gameSlug: "last-bell", seed: 2026118, tokenHash: hashToken(body.token) });
    expect(JSON.stringify(stored)).not.toContain(body.token);
  });

  it("refuses signed-out players, closed boards and ordinary boards", async () => {
    expect((await RUNS(req({}), params(BOARD))).status).toBe(401);
    signedIn();
    h.readEvent.mockResolvedValue({ ...snapshot(), nowMs: Date.parse("2026-11-02T00:00:00Z") });
    const closed = await RUNS(req({}), params(BOARD));
    expect(closed.status).toBe(409);
    expect(await closed.json()).toMatchObject({ reason: "closed", detail: "closed" });
    expect((await RUNS(req({}), params("neon-snake"))).status).toBe(404);
  });
});

describe("GET a championship board", () => {
  it("answers in the ordinary leaderboard shape with public ids only, CDN-cached", async () => {
    h.getPublicChampionship.mockResolvedValue({
      available: true, phase: "live", generatedAt: "", final: false,
      standings: {
        boards: [{ slug: "last-bell", entries: [{ rank: 1, points: 100, publicId: "pub-1", name: "@kid", avatar: "/a.png", score: 300, tiebreak: 180, submittedAt: "" }] }],
        overall: [],
      },
    });
    const res = await GET(new Request("https://hallpass.games/x?limit=10"), params(BOARD));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/public, s-maxage=30/);
    const body = await res.json();
    expect(body).toMatchObject({ game: BOARD, sort: "desc", scoreLabel: "Time left", period: "all" });
    expect(body.scores).toEqual([{ rank: 1, handle: "@kid", score: 300, verified: true, avatar: "/a.png", playerId: "pub-1" }]);
    expect(h.getBoard).not.toHaveBeenCalled();
  });

  it("leaves ordinary boards on the ordinary path", async () => {
    h.getBoard.mockResolvedValue(null);
    const res = await GET(new Request("https://hallpass.games/x"), params("neon-snake"));
    expect(res.status).toBe(409);
    expect(h.getBoard).toHaveBeenCalledWith("neon-snake");
    expect(h.getPublicChampionship).not.toHaveBeenCalled();
  });
});
