/**
 * `POST /api/v1/me/invites`: the origin gate, body validation, who may send
 * what, staged gating, the rate-limit and failure mappings, and the
 * notification each friend invite produces. The store's SQL is covered by
 * `app/lib/invites/store*.test.ts`; here it is a mock.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  playerId: vi.fn(),
  resolveInviteGame: vi.fn(),
  notifyPlayer: vi.fn(),
  reportUnexpected: vi.fn(),
  store: {
    createFriendInvites: vi.fn(),
    createLink: vi.fn(),
  },
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
vi.mock("@/app/lib/invites", () => ({
  invites: h.store,
  resolveInviteGame: h.resolveInviteGame,
  reportUnexpected: h.reportUnexpected,
  stagedViewerAdminEmails: () => ["boss@example.com"],
}));
vi.mock("@/app/lib/notifications/deliver", () => ({ notifyPlayer: h.notifyPlayer }));

import { POST } from "@/app/api/v1/me/invites/route";
import { GUEST_LINK_RATE_LIMIT, LINK_RATE_LIMIT, MAX_RECIPIENTS_PER_REQUEST } from "@/app/lib/invites/config";
import { hashIp } from "@/app/lib/scoreboard/guard";

const ORIGIN = "http://localhost";
const FRIEND_A = "00000000-0000-4000-8000-00000000000a";
const FRIEND_B = "00000000-0000-4000-8000-00000000000b";
const GAME = { slug: "last-bell", title: "LAST BELL" };

function post(
  body: unknown,
  { referer = `${ORIGIN}/embed/invite?game=last-bell`, contentType = "application/json", ip = "203.0.113.9" } = {},
): Request {
  const headers: Record<string, string> = { "content-type": contentType, "x-forwarded-for": ip };
  if (referer) headers.referer = referer;
  return new Request(`${ORIGIN}/api/v1/me/invites`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const FRIENDS_BODY = { game: "last-bell", data: { room: "ABCD" }, to: [FRIEND_A, FRIEND_B] };
const LINK_BODY = { game: "last-bell", data: { room: "ABCD" }, link: true };

beforeEach(() => {
  vi.clearAllMocks();
  h.playerId.mockResolvedValue("google-me");
  h.resolveInviteGame.mockResolvedValue({ game: GAME, staged: false });
  h.notifyPlayer.mockResolvedValue(true);
  h.store.createFriendInvites.mockResolvedValue({
    sent: [
      { toId: "google-a", code: "CDFGHJKMNPQR" },
      { toId: "google-b", code: "TVWXY0123456" },
    ],
    eligible: 2,
    recent: 0,
    rateLimited: false,
    fromDisplayName: "@ozan",
  });
  h.store.createLink.mockResolvedValue({ code: "K7QXM3PDGHT9", rateLimited: false });
});

describe("origin", () => {
  it("refuses a request from a game frame, or with no referrer, before anything else", async () => {
    for (const referer of [`${ORIGIN}/games/last-bell/index.html`, `${ORIGIN}/game-html/last-bell/`, "", "https://evil.example/embed/invite"]) {
      const res = await POST(post(FRIENDS_BODY, { referer }));
      expect(res.status, referer).toBe(403);
      expect(await res.json()).toEqual({ ok: false, sent: 0, reason: "forbidden" });
    }
    expect(h.playerId).not.toHaveBeenCalled();
    expect(h.store.createFriendInvites).not.toHaveBeenCalled();
  });

  it("is never cacheable", async () => {
    const res = await POST(post(FRIENDS_BODY));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("validation", () => {
  const cases: [string, unknown][] = [
    ["not JSON", "{nope"],
    ["an array body", [1]],
    ["no game", { data: {}, link: true }],
    ["a bad slug", { game: "Last Bell", data: {}, link: true }],
    ["no data", { game: "last-bell", link: true }],
    ["array data", { game: "last-bell", data: [1], link: true }],
    ["string data", { game: "last-bell", data: "room", link: true }],
    ["oversized data", { game: "last-bell", data: { s: "x".repeat(1100) }, link: true }],
    ["a string expiry", { ...LINK_BODY, expiresInMinutes: "30" }],
    ["nothing to do", { game: "last-bell", data: {} }],
    ["an empty recipient list and no link", { game: "last-bell", data: {}, to: [] }],
    ["a non-array to", { ...FRIENDS_BODY, to: FRIEND_A }],
    ["a non-uuid recipient", { ...FRIENDS_BODY, to: ["google-a"] }],
    ["a non-boolean link", { ...LINK_BODY, link: "yes" }],
    ["too many recipients", { ...FRIENDS_BODY, to: Array.from({ length: MAX_RECIPIENTS_PER_REQUEST + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`) }],
  ];
  for (const [name, body] of cases) {
    it(`refuses ${name}`, async () => {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      expect((await res.json()).reason).toBe("bad-request");
    });
  }

  it("refuses a form post (the CSRF guard)", async () => {
    const res = await POST(post(LINK_BODY, { contentType: "text/plain" }));
    expect(res.status).toBe(400);
  });

  it("refuses an oversized body without parsing it", async () => {
    const res = await POST(post({ ...LINK_BODY, pad: "x".repeat(9000) }));
    expect(res.status).toBe(400);
  });
});

describe("friend invites", () => {
  it("need a session", async () => {
    h.playerId.mockResolvedValue(null);
    const res = await POST(post(FRIENDS_BODY));
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("signed-out");
    expect(h.store.createFriendInvites).not.toHaveBeenCalled();
  });

  it("answer an unknown or hidden staged game as unknown", async () => {
    h.resolveInviteGame.mockResolvedValue(null);
    const res = await POST(post(FRIENDS_BODY));
    expect(res.status).toBe(404);
    expect((await res.json()).reason).toBe("unknown-game");
  });

  it("write one invite per recipient and notify each with a per-invite dedupe key", async () => {
    const res = await POST(post({ ...FRIENDS_BODY, to: [FRIEND_A, FRIEND_B.toUpperCase(), FRIEND_A], expiresInMinutes: 45 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sent: 2 });

    const input = h.store.createFriendInvites.mock.calls[0][0];
    expect(input).toMatchObject({
      senderId: "google-me",
      slug: "last-bell",
      json: '{"room":"ABCD"}',
      toPublicIds: [FRIEND_A, FRIEND_B],
      ttlSeconds: 45 * 60,
      stagedOnly: false,
      adminEmails: [],
    });
    expect(input.codes).toHaveLength(2);

    expect(h.notifyPlayer).toHaveBeenCalledTimes(2);
    expect(h.notifyPlayer).toHaveBeenCalledWith("google-a", {
      kind: "game_invite",
      copy: {
        title: "@ozan invited you to play LAST BELL",
        body: "Tap to join them. The invite runs out in 45 minutes.",
        url: "/i/CDFGHJKMNPQR",
      },
      dedupeKey: "game_invite:CDFGHJKMNPQR",
    });
  });

  it("default to 30 minutes and clamp to 120", async () => {
    await POST(post(FRIENDS_BODY));
    expect(h.store.createFriendInvites.mock.calls[0][0].ttlSeconds).toBe(1800);
    await POST(post({ ...FRIENDS_BODY, expiresInMinutes: 100000 }));
    expect(h.store.createFriendInvites.mock.calls[1][0].ttlSeconds).toBe(7200);
  });

  it("restrict recipients to staged viewers for a staged game", async () => {
    h.resolveInviteGame.mockResolvedValue({ game: GAME, staged: true });
    await POST(post(FRIENDS_BODY));
    expect(h.store.createFriendInvites.mock.calls[0][0]).toMatchObject({
      stagedOnly: true,
      adminEmails: ["boss@example.com"],
    });
  });

  it("report zero sent without saying why", async () => {
    h.store.createFriendInvites.mockResolvedValue({ sent: [], eligible: 0, recent: 0, rateLimited: false, fromDisplayName: "Player" });
    const res = await POST(post(FRIENDS_BODY));
    expect(await res.json()).toEqual({ ok: true, sent: 0 });
    expect(h.notifyPlayer).not.toHaveBeenCalled();
  });

  it("map the hourly limit to 429 and make no link", async () => {
    h.store.createFriendInvites.mockResolvedValue({ sent: [], eligible: 2, recent: 19, rateLimited: true, fromDisplayName: "x" });
    const res = await POST(post({ ...FRIENDS_BODY, link: true }));
    expect(res.status).toBe(429);
    expect((await res.json()).reason).toBe("rate-limited");
    expect(h.store.createLink).not.toHaveBeenCalled();
  });

  it("map a store failure to 503 and log it", async () => {
    const error = new Error("boom");
    h.store.createFriendInvites.mockRejectedValue(error);
    const res = await POST(post(FRIENDS_BODY));
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("unavailable");
    expect(h.reportUnexpected).toHaveBeenCalledWith("POST me/invites", error);
  });
});

describe("links", () => {
  it("work for a guest, keyed by a salted hash of the IP", async () => {
    h.playerId.mockResolvedValue(null);
    const res = await POST(post(LINK_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      sent: 0,
      code: "K7QXM3PDGHT9",
      url: `${ORIGIN}/i/K7QXM3PDGHT9`,
    });
    const input = h.store.createLink.mock.calls[0][0];
    expect(input).toMatchObject({ senderId: null, limit: GUEST_LINK_RATE_LIMIT });
    expect(input.senderKey).toBe(hashIp("invite-ip:203.0.113.9"));
    expect(input.senderKey).not.toContain("203.0.113.9");
  });

  it("are keyed by the player when signed in", async () => {
    await POST(post(LINK_BODY));
    expect(h.store.createLink.mock.calls[0][0]).toMatchObject({
      senderId: "google-me",
      senderKey: null,
      limit: LINK_RATE_LIMIT,
    });
  });

  it("map the limit to 429", async () => {
    h.store.createLink.mockResolvedValue({ code: null, rateLimited: true });
    const res = await POST(post(LINK_BODY));
    expect(res.status).toBe(429);
  });

  it("still report friends invited when only the link is refused", async () => {
    h.store.createLink.mockResolvedValue({ code: null, rateLimited: true });
    const res = await POST(post({ ...FRIENDS_BODY, link: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sent: 2 });
  });

  it("accept a request from every first-party surface the picker can be on", async () => {
    for (const referer of [`${ORIGIN}/embed/invite?game=x`, `${ORIGIN}/game/last-bell`, `${ORIGIN}/`]) {
      expect((await POST(post(LINK_BODY, { referer }))).status, referer).toBe(200);
    }
  });
});
