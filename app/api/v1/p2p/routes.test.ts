/**
 * The four P2P signaling routes: input validation, the refusal codes the SDK
 * maps to player-facing errors, who may message whom, and the privacy rule that
 * the config endpoint hands out the PUBLIC display name only.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  playerId: vi.fn(),
  canUseGame: vi.fn(),
  store: {
    allowAttempt: vi.fn(),
    createRoom: vi.fn(),
    lookupForJoin: vi.fn(),
    recordJoin: vi.fn(),
    poll: vi.fn(),
    closeRoom: vi.fn(),
    playerNameFields: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/db", () => ({
  sql: () => Promise.resolve([]),
  isMissingColumnError: (e: unknown) => (e as { code?: string })?.code === "42P01",
  isUnconfiguredDbError: () => false,
}));
vi.mock("@/app/lib/games-store", () => ({ isKnownSlug: vi.fn(), isStagedSlug: vi.fn() }));
vi.mock("@/app/lib/beta/staged-access", () => ({ canViewStaged: vi.fn() }));
vi.mock("@/app/lib/social/request-guard", () => ({ currentPlayerId: h.playerId }));
vi.mock("@/app/lib/players", () => ({
  publicDisplayName: (p: { handle: string | null; username: string | null }) =>
    p.handle?.trim() || (p.username ? `@${p.username}` : "Player"),
}));
vi.mock("@/app/lib/p2p", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/app/lib/p2p")>();
  return { ...real, p2pStore: h.store, canUseGame: h.canUseGame };
});

import { GET as configGET } from "@/app/api/v1/p2p/config/route";
import { POST as createPOST } from "@/app/api/v1/p2p/rooms/route";
import { POST as joinPOST } from "@/app/api/v1/p2p/rooms/[code]/join/route";
import { POST as signalPOST } from "@/app/api/v1/p2p/rooms/[code]/signal/route";
import { mintSignalToken } from "@/app/lib/p2p/tokens";
import { derivePeerId } from "@/sdk/p2p/src/codes";

const SECRET = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";

function post(url: string, body: unknown, contentType = "application/json"): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: JSON.stringify(body),
  });
}

const params = (code: string) => ({ params: Promise.resolve({ code }) });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.P2P_SIGNING_SECRET = "test-signing-secret";
  delete process.env.P2P_DISABLED;
  delete process.env.P2P_FORCE_RELAY;
  delete process.env.P2P_TURN_URLS;
  delete process.env.P2P_TURN_SECRET;
  h.playerId.mockResolvedValue(null);
  h.canUseGame.mockResolvedValue(true);
  h.store.allowAttempt.mockResolvedValue(true);
  h.store.createRoom.mockResolvedValue(true);
  h.store.recordJoin.mockResolvedValue(undefined);
  h.store.poll.mockResolvedValue({ alive: true, messages: [] });
});

describe("GET /api/v1/p2p/config", () => {
  it("validates the game id", async () => {
    expect((await configGET(new Request("http://localhost/api/v1/p2p/config?game=NO!"))).status).toBe(400);
    h.canUseGame.mockResolvedValue(false);
    expect((await configGET(new Request("http://localhost/api/v1/p2p/config?game=nope"))).status).toBe(404);
  });

  it("returns STUN and a null identity for a guest", async () => {
    const res = await configGET(new Request("http://localhost/api/v1/p2p/config?game=last-bell"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(body.self).toBeNull();
    expect(body.turn).toBe(false);
    expect(JSON.stringify(body.iceServers)).toContain("stun:");
  });

  it("gives a signed-in player their PUBLIC name, never the Google name, and no avatar", async () => {
    h.playerId.mockResolvedValue("google-sub");
    h.store.playerNameFields.mockResolvedValue({ handle: null, username: "ana", image: "https://lh3/photo.jpg" });
    const body = await (await configGET(new Request("http://localhost/api/v1/p2p/config?game=last-bell"))).json();
    expect(body.self).toEqual({ name: "@ana", avatarUrl: null });
    expect(JSON.stringify(body)).not.toContain("lh3");
  });

  it("answers 503 when switched off", async () => {
    process.env.P2P_DISABLED = "1";
    expect((await configGET(new Request("http://localhost/api/v1/p2p/config?game=last-bell"))).status).toBe(503);
  });
});

describe("POST /api/v1/p2p/rooms", () => {
  it("creates a room whose token authorises the host", async () => {
    const res = await createPOST(post("/api/v1/p2p/rooms", { gameId: "last-bell", gameVersion: "1.2.0", secret: SECRET }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(body.peerId).toBe(await derivePeerId(SECRET));
    expect(h.store.createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: "last-bell", hostPeer: body.peerId, gameVersion: "1.2.0", relayOnly: false }),
    );
  });

  it("refuses a non-JSON content type (CSRF guard) and bad input", async () => {
    expect((await createPOST(post("/api/v1/p2p/rooms", { gameId: "g", secret: SECRET }, "text/plain"))).status).toBe(400);
    expect((await createPOST(post("/api/v1/p2p/rooms", { gameId: "g", secret: "short" }))).status).toBe(400);
  });

  it("rate-limits", async () => {
    h.store.allowAttempt.mockResolvedValue(false);
    const res = await createPOST(post("/api/v1/p2p/rooms", { gameId: "g", secret: SECRET }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate-limited");
  });

  it("retries another code when one is taken", async () => {
    h.store.createRoom.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = await createPOST(post("/api/v1/p2p/rooms", { gameId: "g", secret: SECRET }));
    expect(res.status).toBe(200);
    expect(h.store.createRoom).toHaveBeenCalledTimes(2);
  });

  it("forces relay-only when the operator says so", async () => {
    process.env.P2P_FORCE_RELAY = "1";
    const body = await (await createPOST(post("/api/v1/p2p/rooms", { gameId: "g", secret: SECRET }))).json();
    expect(body.relayOnly).toBe(true);
  });

  it("answers 503 when the table does not exist yet", async () => {
    h.store.allowAttempt.mockRejectedValue(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    expect((await createPOST(post("/api/v1/p2p/rooms", { gameId: "g", secret: SECRET }))).status).toBe(503);
  });
});

describe("POST /api/v1/p2p/rooms/[code]/join", () => {
  const room = {
    roomId: "room-1",
    hostPeer: "hosthosthost",
    gameVersion: "1.2.0",
    relayOnly: false,
    locked: false,
    full: false,
  };
  const join = (body: Record<string, unknown>, code = "k7qx") =>
    joinPOST(post(`/api/v1/p2p/rooms/${code}/join`, { gameId: "last-bell", secret: OTHER, ...body }), params(code));

  it("queues a join for the host with a sanitised name", async () => {
    h.store.lookupForJoin.mockResolvedValue({ joins: 0, misses: 0, room });
    const res = await join({ gameVersion: "1.2.0", name: "  Ana\u202e " });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.hostId).toBe("hosthosthost");
    expect(h.store.lookupForJoin).toHaveBeenCalledWith("last-bell", "K7QX", expect.any(String));
    expect(h.store.recordJoin).toHaveBeenCalledWith(expect.any(String), "join", {
      roomId: "room-1",
      to: "hosthosthost",
      from: body.peerId,
      body: { k: "join", name: "Ana", v: "1.2.0" },
    });
  });

  it("maps refusals to the SDK's codes", async () => {
    h.store.lookupForJoin.mockResolvedValue({ joins: 0, misses: 0, room: null });
    let res = await join({ gameVersion: "1.2.0" });
    expect([res.status, (await res.json()).error]).toEqual([404, "room-not-found"]);
    expect(h.store.recordJoin).toHaveBeenLastCalledWith(expect.any(String), "miss");

    h.store.lookupForJoin.mockResolvedValue({ joins: 0, misses: 0, room });
    res = await join({ gameVersion: "1.1.0" });
    expect([res.status, await res.json()]).toEqual([409, { ok: false, error: "version-mismatch", hostVersion: "1.2.0" }]);

    h.store.lookupForJoin.mockResolvedValue({ joins: 0, misses: 0, room: { ...room, locked: true } });
    res = await join({ gameVersion: "1.2.0" });
    expect((await res.json()).error).toBe("room-locked");

    h.store.lookupForJoin.mockResolvedValue({ joins: 0, misses: 0, room: { ...room, full: true } });
    res = await join({ gameVersion: "1.2.0" });
    expect((await res.json()).error).toBe("room-full");
  });

  it("rate-limits on too many misses (code guessing)", async () => {
    h.store.lookupForJoin.mockResolvedValue({ joins: 0, misses: 60, room: null });
    expect((await join({ gameVersion: "1" })).status).toBe(429);
  });

  it("answers an unknown game like an unknown room", async () => {
    h.canUseGame.mockResolvedValue(false);
    const res = await join({ gameVersion: "1" });
    expect([res.status, (await res.json()).error]).toEqual([404, "room-not-found"]);
  });

  it("rejects a malformed code", async () => {
    expect((await join({ gameVersion: "1" }, "K0QX")).status).toBe(400);
  });
});

describe("POST /api/v1/p2p/rooms/[code]/signal", () => {
  const host = "hosthosthost";
  const guest = "guestguestgu";
  const tokenFor = (p: string) => mintSignalToken({ r: "room-1", p, hp: host })!;
  const signal = (body: Record<string, unknown>) => signalPOST(post("/api/v1/p2p/rooms/K7QX/signal", body));

  it("rejects a forged token", async () => {
    expect((await signal({ token: "x.y" })).status).toBe(401);
  });

  it("lets a guest message the host only", async () => {
    let res = await signal({ token: tokenFor(guest), send: [{ to: host, data: { k: "sdp" } }] });
    expect(res.status).toBe(200);
    res = await signal({ token: tokenFor(guest), send: [{ to: "otherguestab", data: { k: "sdp" } }] });
    expect(res.status).toBe(403);
  });

  it("lets the host message anyone and records its lobby state", async () => {
    const res = await signal({
      token: tokenFor(host),
      after: 5,
      send: [{ to: guest, data: { k: "sdp" } }],
      state: { locked: true, full: false },
    });
    expect(res.status).toBe(200);
    expect(h.store.poll).toHaveBeenCalledWith({
      roomId: "room-1",
      peerId: host,
      isHost: true,
      after: 5,
      outgoing: [{ to: guest, body: { k: "sdp" } }],
      state: { locked: true, full: false },
    });
  });

  it("ignores lobby state from a guest", async () => {
    await signal({ token: tokenFor(guest), state: { locked: true } });
    expect(h.store.poll).toHaveBeenCalledWith(expect.objectContaining({ isHost: false, state: null }));
  });

  it("closes the room on the host's bye", async () => {
    const body = await (await signal({ token: tokenFor(host), bye: true })).json();
    expect(h.store.closeRoom).toHaveBeenCalledWith("room-1", host);
    expect(body.alive).toBe(false);
  });

  it("refuses oversized messages and bad cursors", async () => {
    expect((await signal({ token: tokenFor(host), send: [{ to: guest, data: "x".repeat(20_000) }] })).status).toBe(413);
    expect((await signal({ token: tokenFor(host), after: -1 })).status).toBe(400);
  });
});
