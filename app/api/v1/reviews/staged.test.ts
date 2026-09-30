/**
 * Staged-game gating on the reviews routes: `GET|POST /games/[slug]/reviews` and
 * `translate`, `helpful`, `report` under `/reviews/[id]`.
 *
 * The contract: a STAGED game answers a viewer who cannot see staged games
 * exactly as an unknown game / missing review does, with `no-store`; testers may
 * POST; `canViewStaged()` (which reads the session) is reached ONLY on the staged
 * branch, so an ordinary game keeps today's headers and cost.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  isKnownSlug: vi.fn(),
  isStagedSlug: vi.fn(),
  canViewStaged: vi.fn(),
  currentPlayerId: vi.fn(),
  reviews: {
    listReviews: vi.fn(),
    summary: vi.fn(),
    upsertReview: vi.fn(),
    slugForReview: vi.fn(),
    visibleReviewBody: vi.fn(),
    toggleHelpful: vi.fn(),
    reportReview: vi.fn(),
  },
  notifyAdmins: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/db", () => ({ isMissingColumnError: () => false }));
vi.mock("@/app/lib/games-store", () => ({
  isKnownSlug: h.isKnownSlug,
  isStagedSlug: h.isStagedSlug,
}));
vi.mock("@/app/lib/beta/staged-access", () => ({ canViewStaged: h.canViewStaged }));
vi.mock("@/app/lib/reviews", () => ({
  reviews: h.reviews,
  authorTagSalt: () => "salt",
  hashBody: () => "hash",
}));
vi.mock("@/app/lib/reviews/translate", () => ({
  normalizeTargetLang: (l: string | null) => l,
  translateReviewBody: async () => ({ text: "hola", source: "en" }),
}));
vi.mock("@/app/lib/notifications/deliver", () => ({ notifyAdmins: h.notifyAdmins }));
vi.mock("@/app/lib/scoreboard/guard", () => ({
  clientKeyFromHeaders: () => "ip",
  hashIp: () => "iphash",
}));
vi.mock("@/app/lib/social/request-guard", () => ({
  NO_STORE: { "Cache-Control": "private, no-store" },
  currentPlayerId: h.currentPlayerId,
  isTrustedOrigin: () => true,
  forbidden: () => new Response(null, { status: 403 }),
  unauthorized: () => new Response(null, { status: 401 }),
  credentialedOptions: () => new Response(null, { status: 204 }),
}));

import * as gameReviews from "@/app/api/v1/games/[slug]/reviews/route";
import * as translate from "@/app/api/v1/reviews/[id]/translate/route";
import * as helpful from "@/app/api/v1/reviews/[id]/helpful/route";
import * as report from "@/app/api/v1/reviews/[id]/report/route";

const slugParams = (slug: string) => ({ params: Promise.resolve({ slug }) });
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

const postReview = (slug: string) =>
  gameReviews.POST(
    new Request(`http://x/api/v1/games/${slug}/reviews`, {
      method: "POST",
      body: JSON.stringify({ body: "A genuinely good game to play.", recommended: true }),
    }),
    slugParams(slug),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.currentPlayerId.mockResolvedValue("p1");
  h.isKnownSlug.mockResolvedValue(true);
  h.isStagedSlug.mockResolvedValue(false);
  h.canViewStaged.mockResolvedValue(false);
  h.reviews.listReviews.mockResolvedValue({ reviews: [] });
  h.reviews.summary.mockResolvedValue({ total: 0, recommended: 0 });
  h.reviews.upsertReview.mockResolvedValue("ok");
  h.reviews.visibleReviewBody.mockResolvedValue("hello");
  h.reviews.toggleHelpful.mockResolvedValue({ helpful: true, count: 1 });
  h.reviews.reportReview.mockResolvedValue("filed");
  h.reviews.slugForReview.mockResolvedValue("some-game");
});

describe("GET /games/[slug]/reviews", () => {
  it("keeps the public CDN headers for an ordinary game, without touching the session", async () => {
    const res = await gameReviews.GET(new Request("http://x/"), slugParams("pub"));
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=30");
    expect(h.reviews.listReviews).toHaveBeenCalled();
    expect(h.canViewStaged).not.toHaveBeenCalled();
  });

  it("returns an empty no-store body for a staged game, never querying reviews", async () => {
    h.isStagedSlug.mockResolvedValue(true);
    const res = await gameReviews.GET(new Request("http://x/"), slugParams("beta"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ reviews: [], total: 0, recommended: 0 });
    expect(h.reviews.listReviews).not.toHaveBeenCalled();
    expect(h.canViewStaged).not.toHaveBeenCalled();
  });
});

describe("POST /games/[slug]/reviews", () => {
  it("accepts a review on an ordinary game without asking canViewStaged", async () => {
    const res = await postReview("pub");
    expect(res.status).toBe(200);
    expect(h.canViewStaged).not.toHaveBeenCalled();
    expect(h.reviews.upsertReview).toHaveBeenCalled();
  });

  it("404s an unknown slug", async () => {
    h.isKnownSlug.mockResolvedValue(false);
    const res = await postReview("nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, reason: "Unknown game" });
  });

  it("answers a staged game to a non-tester exactly as an unknown one", async () => {
    h.isStagedSlug.mockResolvedValue(true);
    const res = await postReview("beta");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ ok: false, reason: "Unknown game" });
    expect(h.reviews.upsertReview).not.toHaveBeenCalled();
  });

  it("lets a tester review a staged game", async () => {
    h.isStagedSlug.mockResolvedValue(true);
    h.canViewStaged.mockResolvedValue(true);
    const res = await postReview("beta");
    expect(res.status).toBe(200);
    expect(h.reviews.upsertReview).toHaveBeenCalled();
  });
});

describe("/reviews/[id] sub-routes", () => {
  it("translate: a public review keeps the CDN cache and never reads the session", async () => {
    const res = await translate.GET(new Request("http://x/?to=es"), idParams("5"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=86400");
    expect(h.canViewStaged).not.toHaveBeenCalled();
  });

  it("translate: a staged review is the same 404 as a missing one for a non-tester", async () => {
    h.isStagedSlug.mockResolvedValue(true);
    const hidden = await translate.GET(new Request("http://x/?to=es"), idParams("5"));
    h.reviews.visibleReviewBody.mockResolvedValue(null);
    const missing = await translate.GET(new Request("http://x/?to=es"), idParams("6"));
    expect(hidden.status).toBe(404);
    expect(hidden.status).toBe(missing.status);
    expect(await hidden.json()).toEqual(await missing.json());
    expect(hidden.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("translate: a tester may translate a staged review", async () => {
    h.isStagedSlug.mockResolvedValue(true);
    h.canViewStaged.mockResolvedValue(true);
    const res = await translate.GET(new Request("http://x/?to=es"), idParams("5"));
    expect(res.status).toBe(200);
  });

  it("helpful: a staged review is a no-op vote for a non-tester", async () => {
    h.isStagedSlug.mockResolvedValue(true);
    const res = await helpful.POST(new Request("http://x/", { method: "POST" }), idParams("5"));
    expect(await res.json()).toEqual({ ok: true, helpful: false, count: 0 });
    expect(h.reviews.toggleHelpful).not.toHaveBeenCalled();
  });

  it("helpful: a tester's vote on a staged review counts; a public review skips the session", async () => {
    h.isStagedSlug.mockResolvedValue(true);
    h.canViewStaged.mockResolvedValue(true);
    await helpful.POST(new Request("http://x/", { method: "POST" }), idParams("5"));
    expect(h.reviews.toggleHelpful).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    h.currentPlayerId.mockResolvedValue("p1");
    h.reviews.slugForReview.mockResolvedValue("some-game");
    h.isStagedSlug.mockResolvedValue(false);
    h.reviews.toggleHelpful.mockResolvedValue({ helpful: true, count: 1 });
    await helpful.POST(new Request("http://x/", { method: "POST" }), idParams("5"));
    expect(h.canViewStaged).not.toHaveBeenCalled();
    expect(h.reviews.toggleHelpful).toHaveBeenCalledTimes(1);
  });

  it("report: a staged review reports ok but files nothing for a non-tester", async () => {
    h.isStagedSlug.mockResolvedValue(true);
    const res = await report.POST(
      new Request("http://x/", { method: "POST", body: "{}" }),
      idParams("5"),
    );
    expect(await res.json()).toEqual({ ok: true });
    expect(h.reviews.reportReview).not.toHaveBeenCalled();
    expect(h.notifyAdmins).not.toHaveBeenCalled();
  });
});
