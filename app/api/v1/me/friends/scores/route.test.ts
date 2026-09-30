/**
 * Staged gating on the friends panel: a non-tester with a tester friend must get
 * exactly the response a scoreless slug gets, never the friend's score or the
 * board title; a tester gets the real standings; a live game skips the gate.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  playerId: vi.fn(),
  standings: vi.fn(),
  counts: vi.fn(),
  isStagedSlug: vi.fn(),
  canViewStaged: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/db", () => ({
  isMissingColumnError: () => false,
  isUnconfiguredDbError: () => false,
}));
vi.mock("@/app/lib/scoreboard", () => ({
  store: { getFriendStandingsForGame: h.standings },
}));
vi.mock("@/app/lib/social", () => ({ social: { counts: h.counts } }));
vi.mock("@/app/lib/games-store", () => ({ isStagedSlug: h.isStagedSlug }));
vi.mock("@/app/lib/beta/staged-access", () => ({ canViewStaged: h.canViewStaged }));
vi.mock("@/app/lib/social/request-guard", () => ({
  NO_STORE: { "Cache-Control": "private, no-store" },
  currentPlayerId: h.playerId,
  credentialedOptions: () => new Response(null, { status: 204 }),
}));

import { GET } from "@/app/api/v1/me/friends/scores/route";

const FRIEND_ROW = [{ isYou: false, boardTitle: "Secret Board", score: 99 }];
const call = (slug: string) => GET(new Request(`http://x/?slug=${slug}`));
const snap = async (res: Response) => ({
  status: res.status,
  body: await res.text(),
  headers: [...res.headers].sort(),
});

beforeEach(() => {
  vi.clearAllMocks();
  h.playerId.mockResolvedValue("p1");
  h.standings.mockImplementation(async (_p: string, slug: string) =>
    slug === "beta" ? FRIEND_ROW : [],
  );
  h.counts.mockResolvedValue({ friends: 3 });
  h.isStagedSlug.mockImplementation(async (s: string) => s === "beta");
  h.canViewStaged.mockResolvedValue(false);
});

describe("GET /me/friends/scores on a staged game", () => {
  it("hides a tester friend's score from a non-tester, matching a scoreless slug exactly", async () => {
    const staged = await snap(await call("beta"));
    const scoreless = await snap(await call("nothing-here"));
    expect(staged).toEqual(scoreless);
    expect(staged.body).not.toContain("Secret Board");
    expect(h.standings).not.toHaveBeenCalledWith("p1", "beta");
  });

  it("shows a tester the real standings", async () => {
    h.canViewStaged.mockResolvedValue(true);
    const res = await call("beta");
    expect((await res.json()).standings).toEqual(FRIEND_ROW);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("does not consult the gate for a live game", async () => {
    await call("live");
    expect(h.canViewStaged).not.toHaveBeenCalled();
    expect(h.standings).toHaveBeenCalledWith("p1", "live");
  });
});
