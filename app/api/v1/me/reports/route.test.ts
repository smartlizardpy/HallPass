/**
 * `POST /api/v1/me/reports`: origin gate, validation, signed-in only, and the
 * mapping of store outcomes. The store's SQL is covered by
 * `app/lib/profile-reports/store.test.ts`; here it is a mock.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  playerId: vi.fn(),
  reportUnexpected: vi.fn(),
  store: { create: vi.fn() },
  notifyAdmins: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/social/request-guard", async () => {
  const origin = await vi.importActual<typeof import("@/app/lib/social/origin")>("@/app/lib/social/origin");
  return {
    NO_STORE: { "Cache-Control": "private, no-store" },
    currentPlayerId: h.playerId,
    isTrustedOrigin: origin.isTrustedOrigin,
    credentialedOptions: () => new Response(null, { status: 204 }),
  };
});
vi.mock("@/app/lib/profile-reports", () => ({
  profileReports: h.store,
  reportUnexpected: h.reportUnexpected,
}));

vi.mock("@/app/lib/notifications/deliver", () => ({ notifyAdmins: h.notifyAdmins }));

import { POST } from "@/app/api/v1/me/reports/route";

const ORIGIN = "http://localhost";
const TARGET = "00000000-0000-4000-8000-00000000000a";

function post(
  body: unknown,
  { referer = `${ORIGIN}/u/sam`, contentType = "application/json" } = {},
): Request {
  const headers: Record<string, string> = { "content-type": contentType };
  if (referer) headers.referer = referer;
  return new Request(`${ORIGIN}/api/v1/me/reports`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const GOOD = { id: TARGET, reason: "bullying", note: "  they keep being mean  " };

beforeEach(() => {
  vi.clearAllMocks();
  h.playerId.mockResolvedValue("google-me");
  h.store.create.mockResolvedValue({ result: "created" });
  h.notifyAdmins.mockResolvedValue(undefined);
});

describe("POST /api/v1/me/reports", () => {
  it("files a report with the trimmed note and the session's player", async () => {
    const res = await POST(post(GOOD));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.store.create).toHaveBeenCalledWith({
      reporterId: "google-me",
      reportedPublicId: TARGET,
      reason: "bullying",
      note: "they keep being mean",
    });
  });

  it("notifies admins of a NEW report, naming neither player, the note nor the reporter", async () => {
    await POST(post(GOOD));
    expect(h.notifyAdmins).toHaveBeenCalledTimes(1);
    const arg = h.notifyAdmins.mock.calls[0][0];
    expect(arg.kind).toBe("profile_reported");
    expect(arg.copy.body).toBe("A profile was reported (Bullying). Open moderation to read it.");
    expect(arg.copy.url).toBe("/dashboard/moderation");
    const text = JSON.stringify(arg);
    for (const secret of ["google-me", TARGET, "they keep being mean"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("sends no notification for a duplicate, a refusal or a rate limit", async () => {
    for (const result of ["duplicate", "self", "unknown", "rate-limited"]) {
      h.store.create.mockResolvedValue({ result });
      await POST(post(GOOD));
    }
    expect(h.notifyAdmins).not.toHaveBeenCalled();
  });

  it("still answers ok when the notification fails", async () => {
    h.notifyAdmins.mockRejectedValue(new Error("push down"));
    const res = await POST(post(GOOD));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("refuses a game iframe's referrer and a missing one before anything else", async () => {
    expect((await POST(post(GOOD, { referer: `${ORIGIN}/game-html/x/index.html` }))).status).toBe(403);
    expect((await POST(post(GOOD, { referer: "" }))).status).toBe(403);
    expect(h.playerId).not.toHaveBeenCalled();
    expect(h.store.create).not.toHaveBeenCalled();
  });

  it("is 401 when signed out", async () => {
    h.playerId.mockResolvedValue(null);
    const res = await POST(post(GOOD));
    expect(res.status).toBe(401);
    expect(h.store.create).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies", async () => {
    for (const bad of [
      "not json",
      { ...GOOD, id: "sam" },
      { ...GOOD, id: undefined },
      { ...GOOD, reason: "hate" },
      { ...GOOD, reason: undefined },
      { ...GOOD, note: 5 },
      { ...GOOD, note: "x".repeat(301) },
    ]) {
      expect((await POST(post(bad))).status).toBe(400);
    }
    expect((await POST(post(GOOD, { contentType: "text/plain" }))).status).toBe(400);
    expect(h.store.create).not.toHaveBeenCalled();
  });

  it("answers a duplicate exactly like a new report", async () => {
    h.store.create.mockResolvedValue({ result: "duplicate" });
    const res = await POST(post(GOOD));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("maps self, unknown, rate-limited and a database fault", async () => {
    const cases: [string, number, string][] = [
      ["self", 400, "self"],
      ["unknown", 404, "unavailable"],
      ["rate-limited", 429, "rate-limited"],
    ];
    for (const [result, status, reason] of cases) {
      h.store.create.mockResolvedValue({ result });
      const res = await POST(post(GOOD));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ ok: false, reason });
    }
    h.store.create.mockRejectedValue(new Error("boom"));
    const res = await POST(post(GOOD));
    expect(res.status).toBe(503);
    expect(h.reportUnexpected).toHaveBeenCalled();
  });
});
