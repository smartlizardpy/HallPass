import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  rules: vi.fn(async () => ({ enabled: true, bonus: 10, cap: 4 })),
  recordVisit: vi.fn(async () => true),
  track: vi.fn(async () => undefined),
  claim: vi.fn(async () => "attributed"),
}));
const session = vi.hoisted(() => ({ playerId: null as string | null }));

vi.mock("@/app/lib/referrals", async () => {
  const actual = await vi.importActual<typeof import("@/app/lib/referrals/config")>("@/app/lib/referrals/config");
  return {
    referralStore: store,
    REFERRALS: actual.REFERRAL_FRIGHT_FEST_2026,
    attributeFromRequest: vi.fn(),
    getMine: vi.fn(async () => ({ available: true })),
    tokenFromCookieHeader: (h: string | null) => {
      const m = /hp_fref=([^;]+)/.exec(h ?? "");
      return m ? actual.normalizeReferralToken(decodeURIComponent(m[1])) : null;
    },
  };
});
vi.mock("@/app/lib/referrals/http", async () => {
  const actual = await vi.importActual<typeof import("@/app/lib/referrals/config")>("@/app/lib/referrals/config");
  const NO_STORE = { "Cache-Control": "private, no-store" };
  return {
    NO_STORE,
    crossSite: (req: Request) => {
      const o = req.headers.get("origin");
      return !!o && new URL(o).host !== new URL(req.url).host;
    },
    fail: (status: number, error: string) => Response.json({ error }, { status, headers: NO_STORE }),
    json: (body: unknown, status: number) => Response.json(body, { status, headers: NO_STORE }),
    referralPlayer: async () => session.playerId,
    pendingCookie: (_u: string, token: string) => `${actual.REFERRAL_FRIGHT_FEST_2026.cookie}=${token}; Path=/`,
  };
});

import { POST as visit } from "./visit/route";
import { POST as track } from "./track/route";

const TOKEN = "7CDFGHJKMNPQ";
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

beforeEach(() => {
  vi.clearAllMocks();
  session.playerId = null;
});

describe("POST /api/v1/referrals/visit", () => {
  it("counts the visit and sets the cookie on a first visit", async () => {
    const res = await visit(post("https://x.test/api/v1/referrals/visit", { token: TOKEN.toLowerCase() }));
    expect(res.status).toBe(200);
    expect(store.recordVisit).toHaveBeenCalledWith(TOKEN);
    expect(res.headers.get("set-cookie")).toContain(TOKEN);
    expect(store.claim).not.toHaveBeenCalled(); // signed out: nothing to attribute yet
  });

  it("is FIRST TOUCH: a second link neither overwrites the cookie nor gets attributed", async () => {
    session.playerId = "me";
    const other = "CDFGHJKMNPQR";
    const res = await visit(post("https://x.test/api/v1/referrals/visit", { token: other }, { cookie: `hp_fref=${TOKEN}` }));
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(store.claim).toHaveBeenCalledWith("me", TOKEN);
  });

  it("does not recount a refresh of the same link", async () => {
    await visit(post("https://x.test/api/v1/referrals/visit", { token: TOKEN }, { cookie: `hp_fref=${TOKEN}` }));
    expect(store.recordVisit).not.toHaveBeenCalled();
  });

  it("attributes a signed-in visitor straight away", async () => {
    session.playerId = "me";
    await visit(post("https://x.test/api/v1/referrals/visit", { token: TOKEN }));
    expect(store.claim).toHaveBeenCalledWith("me", TOKEN);
  });

  it("refuses a malformed token and a cross-site request", async () => {
    expect((await visit(post("https://x.test/a", { token: "bad" }))).status).toBe(400);
    expect((await visit(post("https://x.test/a", { token: TOKEN }, { origin: "https://evil.test" }))).status).toBe(403);
  });
});

describe("POST /api/v1/referrals/track", () => {
  it("counts a known kind", async () => {
    expect((await track(post("https://x.test/a", { kind: "post_copy" }))).status).toBe(200);
    expect(store.track).toHaveBeenCalledWith("post_copy");
  });
  it("refuses an unknown kind and a cross-site request", async () => {
    expect((await track(post("https://x.test/a", { kind: "drop table" }))).status).toBe(400);
    expect((await track(post("https://x.test/a", { kind: "post_copy" }, { origin: "https://evil.test" }))).status).toBe(403);
    expect(store.track).not.toHaveBeenCalled();
  });
});
