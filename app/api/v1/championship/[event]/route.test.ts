import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ auth: vi.fn(), getPublicChampionship: vi.fn(), getMyProgress: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/app/lib/championship", () => ({ getPublicChampionship: h.getPublicChampionship, getMyProgress: h.getMyProgress }));

import { GET } from "./route";
import { GET as ME } from "./me/route";

const params = (event: string) => ({ params: Promise.resolve({ event }) });
const r = () => new Request("https://hallpass.games/api/v1/championship/x");

beforeEach(() => vi.clearAllMocks());

describe("GET /api/v1/championship/<event>", () => {
  it("serves the public table, CDN-cached", async () => {
    h.getPublicChampionship.mockResolvedValue({ available: true, phase: "live", standings: { boards: [], overall: [] } });
    const res = await GET(r(), params("fright-fest-2026"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=30, stale-while-revalidate=120");
  });
  it("caches an unavailable answer only briefly", async () => {
    h.getPublicChampionship.mockResolvedValue({ available: false, phase: "live", standings: null });
    expect((await GET(r(), params("fright-fest-2026"))).headers.get("cache-control")).toBe("public, s-maxage=5");
  });
  it("404s an unknown championship", async () => {
    expect((await GET(r(), params("nope"))).status).toBe(404);
  });
});

describe("GET /api/v1/championship/<event>/me", () => {
  it("says signed out without an error, uncached", async () => {
    h.auth.mockResolvedValue(null);
    const res = await ME(r(), params("fright-fest-2026"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: false });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(h.getMyProgress).not.toHaveBeenCalled();
  });
  it("reads only the session player's progress", async () => {
    h.auth.mockResolvedValue({ user: { playerId: "g-1" } });
    h.getMyProgress.mockResolvedValue({ available: true, rank: 2 });
    const res = await ME(r(), params("fright-fest-2026"));
    expect(await res.json()).toEqual({ signedIn: true, available: true, rank: 2 });
    expect(h.getMyProgress.mock.calls[0][1]).toBe("g-1");
  });
});
