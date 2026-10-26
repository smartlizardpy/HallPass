/**
 * The candy routes: same-origin and credentialed (401 signed out, 403 cross-site,
 * `private, no-store`), the spend's status codes, and that the request is handed
 * to the store untouched.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  spend: vi.fn(),
  getMyCandy: vi.fn(),
  getGamePayouts: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/app/lib/candy", async () => {
  const { CANDY_FRIGHT_FEST_2026 } = await import("@/app/lib/candy/fright-fest-2026");
  return { CANDY: CANDY_FRIGHT_FEST_2026, candyStore: { spend: h.spend }, getMyCandy: h.getMyCandy, getGamePayouts: h.getGamePayouts };
});

import { GET as ME } from "@/app/api/v1/candy/me/route";
import { POST as SPEND } from "@/app/api/v1/candy/spend/route";

const REQ = "11111111-2222-4333-8444-555555555555";
const me = (origin?: string) => ME(new Request("https://hallpass.games/api/v1/candy/me", { headers: origin ? { origin } : {} }));
const spend = (body: unknown, origin?: string) =>
  SPEND(
    new Request("https://hallpass.games/api/v1/candy/spend", {
      method: "POST",
      headers: origin ? { origin } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const signedIn = () => h.auth.mockResolvedValue({ user: { playerId: "p1" } });

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue(null);
  h.getGamePayouts.mockResolvedValue([]);
});

describe("GET /candy/me", () => {
  it("refuses a cross-site Origin", async () => {
    signedIn();
    expect((await me("https://evil.example")).status).toBe(403);
    expect(h.getMyCandy).not.toHaveBeenCalled();
  });

  it("says signedIn:false when signed out, with the public rules and prices, and never reads a ledger", async () => {
    const res = await me();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(body.signedIn).toBe(false);
    expect(body.spend.untilLabel).toBe("30 Nov 2026, 23:59 UK");
    expect(body.rules).toMatchObject({ rankedRun: 10, allBoards: 20, maxGameCandy: 40 });
    expect(body.rules.maxAchievementCandy).toBeUndefined();
    expect(body.rules.dailyBest).toEqual([
      { label: "1st", pct: 100 }, { label: "2nd–3rd", pct: 75 }, { label: "4th–10th", pct: 50 },
      { label: "Top half", pct: 25 }, { label: "On the board", pct: 5 },
    ]);
    expect(body.games).toEqual([]);
    expect(body.shop).toHaveLength(8);
    expect(body.shop.every((i: { affordable: boolean }) => i.affordable === false)).toBe(true);
    expect(h.getMyCandy).not.toHaveBeenCalled();
  });

  it("syncs and returns the player's own candy, private, with no CORS grant", async () => {
    signedIn();
    const payout = { boardId: "duskfall-score", slug: "duskfall", title: "Duskfall", boardTitle: "High score", candy: 20 };
    h.getGamePayouts.mockResolvedValue([payout]);
    h.getMyCandy.mockResolvedValue({
      available: true, balance: 42, newlyCredited: { count: 1, amount: 10 }, shop: [],
      recent: [{ kind: "daily_best", label: "Best score on 29 Oct · 3rd", game: "Duskfall", amount: 15, at: "2026-10-29T10:00:00.000Z", revoked: false }],
    });
    const res = await me("https://hallpass.games");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(h.getMyCandy).toHaveBeenCalledWith("p1");
    expect(body).toMatchObject({ signedIn: true, available: true, balance: 42, event: "fright-fest-2026" });
    expect(body.spend.until).toBe("2026-12-01T00:00:00Z");
    expect(body.games).toEqual([payout]);
    expect(body.recent[0]).toMatchObject({ kind: "daily_best", label: "Best score on 29 Oct · 3rd", game: "Duskfall" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/playerId|"p1"/);
  });
});

describe("POST /candy/spend", () => {
  it("refuses a cross-site Origin before anything else, then a signed-out caller", async () => {
    signedIn();
    expect((await spend({ packId: "hpo-standard", requestId: REQ }, "https://evil.example")).status).toBe(403);
    h.auth.mockResolvedValue(null);
    const res = await spend({ packId: "hpo-standard", requestId: REQ });
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(h.spend).not.toHaveBeenCalled();
  });

  it("400s a bad body, a missing pack and a malformed request id without touching the store", async () => {
    signedIn();
    expect((await spend("not json")).status).toBe(400);
    expect((await spend([1])).status).toBe(400);
    expect((await spend({ requestId: REQ })).status).toBe(400);
    expect((await spend({ packId: 5, requestId: REQ })).status).toBe(400);
    expect((await spend({ packId: "hpo-standard" })).status).toBe(400);
    expect((await spend({ packId: "hpo-standard", requestId: "x" })).status).toBe(400);
    expect((await spend({ packId: "hpo-standard", requestId: "has spaces in it" })).status).toBe(400);
    expect(h.spend).not.toHaveBeenCalled();
  });

  it("buys, passing the session's player and the body's pack and request id", async () => {
    signedIn();
    h.spend.mockResolvedValue({ status: "ok", alreadySpent: false, packPublicId: "pack-uuid", packId: "hpo-standard", price: 30, balance: 70 });
    const res = await spend({ packId: "hpo-standard", requestId: REQ, playerId: "forged" }, "https://hallpass.games");
    expect(h.spend).toHaveBeenCalledWith("p1", "hpo-standard", REQ);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      alreadySpent: false,
      balance: 70,
      price: 30,
      pack: { id: "pack-uuid", packId: "hpo-standard", name: "HallPass Originals Pack" },
    });
  });

  it("answers a repeat with the same pack and alreadySpent: true", async () => {
    signedIn();
    h.spend.mockResolvedValue({ status: "ok", alreadySpent: true, packPublicId: "pack-uuid", packId: "hpo-standard", price: 30, balance: 70 });
    const body = await (await spend({ packId: "hpo-standard", requestId: REQ })).json();
    expect(body.alreadySpent).toBe(true);
    expect(body.pack.id).toBe("pack-uuid");
  });

  it("maps the store's refusals: 400 bad pack, 409 not enough, 410 closed", async () => {
    signedIn();
    h.spend.mockResolvedValueOnce({ status: "bad-pack" });
    expect((await spend({ packId: "ff26-participation", requestId: REQ })).status).toBe(400);
    h.spend.mockResolvedValueOnce({ status: "bad-request" });
    expect((await spend({ packId: "hpo-standard", requestId: REQ })).status).toBe(400);
    h.spend.mockResolvedValueOnce({ status: "insufficient", balance: 12, price: 30 });
    const poor = await spend({ packId: "hpo-standard", requestId: REQ });
    expect(poor.status).toBe(409);
    expect(await poor.json()).toMatchObject({ balance: 12, price: 30 });
    h.spend.mockResolvedValueOnce({ status: "closed", reason: "expired" });
    const gone = await spend({ packId: "hpo-standard", requestId: REQ });
    expect(gone.status).toBe(410);
    expect(await gone.json()).toMatchObject({ reason: "expired" });
    expect(gone.headers.get("cache-control")).toBe("private, no-store");
  });

  it("turns a database failure into a retryable 503", async () => {
    signedIn();
    h.spend.mockRejectedValue(new Error("neon down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await spend({ packId: "hpo-standard", requestId: REQ });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
    err.mockRestore();
  });
});
