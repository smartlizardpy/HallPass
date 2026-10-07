/**
 * The two public survey routes: `GET /surveys/active` (banner) and
 * `POST /surveys/[slug]/respond`.
 *
 * The contract worth pinning: guests and forged origins never reach the store;
 * a survey that is not open answers the same 404 whatever the reason; the
 * database's uniqueness decides a double submit; and no refusal reflects what
 * the player typed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  currentPlayerId: vi.fn(),
  isTrustedOrigin: vi.fn(),
  getPublicSurvey: vi.fn(),
  getBannerSurvey: vi.fn(),
  submitResponse: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/db", () => ({
  isMissingColumnError: (e: unknown) => (e as { code?: string })?.code === "42P01",
}));
vi.mock("@/app/lib/surveys", () => ({
  getPublicSurvey: h.getPublicSurvey,
  getBannerSurvey: h.getBannerSurvey,
  surveys: { submitResponse: h.submitResponse },
}));
vi.mock("@/app/lib/social/request-guard", () => ({
  NO_STORE: { "Cache-Control": "private, no-store" },
  currentPlayerId: h.currentPlayerId,
  isTrustedOrigin: h.isTrustedOrigin,
  forbidden: () => new Response(null, { status: 403 }),
  unauthorized: () => new Response(null, { status: 401 }),
  credentialedOptions: () => new Response(null, { status: 204 }),
}));

import { GET as getActive } from "./active/route";
import { POST as respond } from "./[slug]/respond/route";

const survey = {
  id: 7,
  slug: "winter",
  title: "Winter",
  intro: "",
  closesAt: null,
  answered: false,
  questions: [
    {
      id: 1,
      kind: "single" as const,
      prompt: "Genre?",
      required: true,
      options: [
        { id: "o1", label: "Racing" },
        { id: "o2", label: "Puzzle" },
      ],
    },
    { id: 2, kind: "text" as const, prompt: "Anything else?", required: false, options: [] },
  ],
};

const params = { params: Promise.resolve({ slug: "winter" }) };
const post = (body: unknown) =>
  respond(
    new Request("http://x/api/v1/surveys/winter/respond", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    params,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.currentPlayerId.mockResolvedValue("p1");
  h.isTrustedOrigin.mockReturnValue(true);
  h.getPublicSurvey.mockResolvedValue(survey);
  h.getBannerSurvey.mockResolvedValue({ slug: "winter", title: "Winter", answered: false });
  h.submitResponse.mockResolvedValue("ok");
});

describe("GET /surveys/active", () => {
  it("shows a guest nothing, without reading the database", async () => {
    h.currentPlayerId.mockResolvedValue(null);
    const res = await getActive();
    expect(await res.json()).toEqual({ survey: null });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(h.getBannerSurvey).not.toHaveBeenCalled();
  });

  it("offers the newest unanswered live survey", async () => {
    expect(await (await getActive()).json()).toEqual({
      survey: { slug: "winter", title: "Winter" },
    });
  });

  it("offers nothing once the player has answered, or when nothing is live", async () => {
    h.getBannerSurvey.mockResolvedValue({ slug: "winter", title: "Winter", answered: true });
    expect(await (await getActive()).json()).toEqual({ survey: null });
    h.getBannerSurvey.mockResolvedValue(null);
    expect(await (await getActive()).json()).toEqual({ survey: null });
  });
});

describe("POST /surveys/[slug]/respond", () => {
  it("stores a valid response against the survey's own id and the player", async () => {
    const res = await post({ answers: { "1": "o2", "2": "More puzzles" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.submitResponse).toHaveBeenCalledWith({
      surveyId: 7,
      playerId: "p1",
      answers: [
        { questionId: 1, choiceIds: ["o2"], scale: null, body: null },
        { questionId: 2, choiceIds: null, scale: null, body: "More puzzles" },
      ],
    });
  });

  it("refuses a guest and a forged origin before touching the store", async () => {
    h.currentPlayerId.mockResolvedValue(null);
    expect((await post({ answers: {} })).status).toBe(401);
    h.currentPlayerId.mockResolvedValue("p1");
    h.isTrustedOrigin.mockReturnValue(false);
    expect((await post({ answers: {} })).status).toBe(403);
    expect(h.getPublicSurvey).not.toHaveBeenCalled();
    expect(h.submitResponse).not.toHaveBeenCalled();
  });

  it("answers an unopen survey 404 and an already-answered one 409", async () => {
    h.getPublicSurvey.mockResolvedValue(null);
    expect((await post({ answers: { "1": "o1" } })).status).toBe(404);
    h.getPublicSurvey.mockResolvedValue({ ...survey, answered: true });
    expect((await post({ answers: { "1": "o1" } })).status).toBe(409);
    expect(h.submitResponse).not.toHaveBeenCalled();
  });

  it("returns a 400 naming the question, and never echoes the input", async () => {
    const res = await post({ answers: { "1": "o1", "2": "ring me on 07700 900123" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, questionId: 2 });
    expect(JSON.stringify(body)).not.toContain("07700");
    expect(h.submitResponse).not.toHaveBeenCalled();
  });

  it("refuses a required question left out, and an empty response", async () => {
    expect((await post({ answers: { "2": "hi there" } })).status).toBe(400);
    h.getPublicSurvey.mockResolvedValue({
      ...survey,
      questions: survey.questions.map((q) => ({ ...q, required: false })),
    });
    const empty = await post({ answers: {} });
    expect(empty.status).toBe(400);
    expect((await empty.json()).reason).toMatch(/at least one/i);
  });

  it("turns each store outcome into a distinct response", async () => {
    const ok = { answers: { "1": "o1" } };
    h.submitResponse.mockResolvedValue("duplicate");
    expect((await post(ok)).status).toBe(409);
    h.submitResponse.mockResolvedValue("stale");
    const stale = await post(ok);
    expect(stale.status).toBe(409);
    expect((await stale.json()).reason).toMatch(/reload/i);
    h.submitResponse.mockResolvedValue("closed");
    expect((await post(ok)).status).toBe(404);
  });

  it("rejects malformed and oversized bodies", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post("x".repeat(33 * 1024))).status).toBe(413);
  });

  it("says surveys are off on a missing table and 500s on anything else", async () => {
    h.submitResponse.mockRejectedValue(Object.assign(new Error("no table"), { code: "42P01" }));
    expect((await post({ answers: { "1": "o1" } })).status).toBe(503);
    h.submitResponse.mockRejectedValue(new Error("boom"));
    expect((await post({ answers: { "1": "o1" } })).status).toBe(500);
  });
});
