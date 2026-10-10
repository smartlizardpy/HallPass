/**
 * The SDK's `hallpass` transport against the REAL route handlers.
 *
 * `fetch` is routed straight into the four handlers; Postgres is replaced by an
 * in-memory store with the same semantics as `p2p/store.ts` (acknowledge up to
 * `after`, insert, read the inbox, host heartbeat); WebRTC is the in-memory fake.
 * What this proves is the wiring: HTTP polling signaling, the guest→host-only
 * rule with guest↔guest signals relayed by the host, and the refusal codes the
 * SDK turns into player-facing errors.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface Room {
  gameId: string;
  code: string;
  roomId: string;
  hostPeer: string;
  gameVersion: string;
  relayOnly: boolean;
  locked: boolean;
  full: boolean;
  seen: number;
}

const mem = vi.hoisted(() => {
  const state = {
    rooms: new Map<string, Room>(),
    signals: [] as Array<{ id: number; roomId: string; to: string; from: string; body: unknown }>,
    seq: 0,
    polls: 0,
    /** Every message that ever went through the mailbox: [from, to]. */
    log: [] as Array<[string, string]>,
  };
  const byId = (roomId: string) => [...state.rooms.values()].find((r) => r.roomId === roomId);
  const store = {
    allowAttempt: async () => true,
    createRoom: async (r: Omit<Room, "locked" | "full" | "seen">) => {
      const key = `${r.gameId}/${r.code}`;
      if (state.rooms.has(key)) return false;
      state.rooms.set(key, { ...r, locked: false, full: false, seen: Date.now() });
      return true;
    },
    lookupForJoin: async (gameId: string, code: string) => {
      const room = state.rooms.get(`${gameId}/${code}`);
      return { joins: 0, misses: 0, room: room ? { ...room } : null };
    },
    recordJoin: async (_k: string, _kind: string, s?: { roomId: string; to: string; from: string; body: unknown }) => {
      if (s) {
        state.signals.push({ id: ++state.seq, ...s });
        state.log.push([s.from, s.to]);
      }
    },
    poll: async (p: {
      roomId: string;
      peerId: string;
      isHost: boolean;
      after: number;
      outgoing: Array<{ to: string; body: unknown }>;
      state?: { locked: boolean; full: boolean } | null;
    }) => {
      state.polls++;
      const room = byId(p.roomId);
      if (room && p.isHost) {
        room.seen = Date.now();
        if (p.state) Object.assign(room, p.state);
      }
      state.signals = state.signals.filter((s) => !(s.roomId === p.roomId && s.to === p.peerId && s.id <= p.after));
      const inbox = state.signals
        .filter((s) => s.roomId === p.roomId && s.to === p.peerId && s.id > p.after)
        .slice(0, 64)
        .map((s) => ({ id: s.id, from: s.from, data: JSON.parse(JSON.stringify(s.body)) }));
      if (room) {
        for (const m of p.outgoing) {
          state.signals.push({ id: ++state.seq, roomId: p.roomId, to: m.to, from: p.peerId, body: m.body });
          state.log.push([p.peerId, m.to]);
        }
      }
      return { alive: !!room, messages: inbox };
    },
    closeRoom: async (roomId: string) => {
      for (const [k, r] of state.rooms) if (r.roomId === roomId) state.rooms.delete(k);
    },
    playerNameFields: async () => null,
  };
  return { state, store };
});

vi.mock("server-only", () => ({}));
vi.mock("@/app/lib/db", () => ({
  sql: () => Promise.resolve([]),
  isMissingColumnError: () => false,
  isUnconfiguredDbError: () => false,
}));
vi.mock("@/app/lib/games-store", () => ({ isKnownSlug: async () => true, isStagedSlug: async () => false }));
vi.mock("@/app/lib/beta/staged-access", () => ({ canViewStaged: async () => false }));
vi.mock("@/app/lib/social/request-guard", () => ({ currentPlayerId: async () => null }));
vi.mock("@/app/lib/players", () => ({ publicDisplayName: () => "Player" }));
vi.mock("@/app/lib/p2p", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/app/lib/p2p")>();
  return { ...real, p2pStore: mem.store, canUseGame: async () => true };
});

import { GET as configGET } from "@/app/api/v1/p2p/config/route";
import { POST as createPOST } from "@/app/api/v1/p2p/rooms/route";
import { POST as joinPOST } from "@/app/api/v1/p2p/rooms/[code]/join/route";
import { POST as signalPOST } from "@/app/api/v1/p2p/rooms/[code]/signal/route";
import { env } from "@/sdk/p2p/src/env";
import { connect } from "@/sdk/p2p/src/client";
import type { Client, Room as P2PRoom } from "@/sdk/p2p/src/types";
import { installFakeRTC, net } from "@/sdk/p2p/test/fake-rtc";

const API = "https://hallpass.test";

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(String(input), init);
  const path = new URL(req.url).pathname;
  let m: RegExpMatchArray | null;
  if (path === "/api/v1/p2p/config") return configGET(req);
  if (path === "/api/v1/p2p/rooms") return createPOST(req);
  if ((m = path.match(/^\/api\/v1\/p2p\/rooms\/([^/]+)\/join$/))) return joinPOST(req, { params: Promise.resolve({ code: m[1] }) });
  if (path.match(/^\/api\/v1\/p2p\/rooms\/[^/]+\/signal$/)) return signalPOST(req);
  return new Response("not found", { status: 404 });
}

let clients: Client[] = [];

beforeAll(() => installFakeRTC(env));

beforeEach(() => {
  process.env.P2P_SIGNING_SECRET = "integration-secret";
  vi.stubGlobal("fetch", fakeFetch);
  mem.state.rooms.clear();
  mem.state.signals = [];
  mem.state.log = [];
});

afterEach(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  clients = [];
  net.reset();
  vi.unstubAllGlobals();
});

async function client(name: string, gameVersion = "1.2.0"): Promise<Client> {
  const c = await connect({ gameId: "last-bell", gameVersion, name, transport: "hallpass", api: API });
  clients.push(c);
  return c;
}

const until = async (cond: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("the hallpass transport against the real routes", () => {
  it(
    "forms a 3-player mesh, relays guest↔guest signals through the host, and carries messages",
    async () => {
      const host = await client("Host");
      expect(host.transport).toBe("hallpass");
      const hostRoom = await host.createRoom({ maxPlayers: 4 });
      expect(hostRoom.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);

      const rooms: P2PRoom[] = [hostRoom];
      for (const name of ["Ana", "Ben"]) rooms.push(await (await client(name)).joinRoom(hostRoom.code.toLowerCase()));
      await until(() => rooms.every((r) => r.players.length === 3 && r.players.every((p) => p.connection.state === "connected")));

      // Only host<->guest traffic ever touched the server mailbox.
      const hostId = hostRoom.selfId;
      const [, ana, ben] = rooms;
      const got: string[] = [];
      ben.on("hi", (d: string, meta) => got.push(`${d}:${meta.from === ana.selfId}`));
      ana.send("hi", "direct", { to: ben.selfId });
      await until(() => got.length === 1);
      expect(got).toEqual(["direct:true"]);
      expect(mem.state.log.length).toBeGreaterThan(0);
      expect(mem.state.log.every(([from, to]) => from === hostId || to === hostId)).toBe(true);
    },
    20000,
  );

  it(
    "refuses wrong code, wrong version, a locked and a full room with the right codes",
    async () => {
      const host = await client("Host");
      const room = await host.createRoom({ maxPlayers: 2 });
      await expect((await client("Lost")).joinRoom("ZZZZ")).rejects.toMatchObject({ code: "room-not-found" });
      await expect((await client("Old", "1.0.0")).joinRoom(room.code)).rejects.toMatchObject({ code: "version-mismatch" });

      room.lock();
      await until(() => [...mem.state.rooms.values()][0]?.locked === true);
      await expect((await client("Late")).joinRoom(room.code)).rejects.toMatchObject({ code: "room-locked" });
      room.unlock();
      await until(() => [...mem.state.rooms.values()][0]?.locked === false);

      await (await client("Second")).joinRoom(room.code);
      await until(() => [...mem.state.rooms.values()][0]?.full === true);
      await expect((await client("Third")).joinRoom(room.code)).rejects.toMatchObject({ code: "room-full" });
    },
    20000,
  );

  it(
    "closes the server room when the host leaves, and guests get host-left then closed",
    async () => {
      const host = await client("Host");
      const hostRoom = await host.createRoom();
      const guest = await (await client("Guest")).joinRoom(hostRoom.code);
      const seen: string[] = [];
      guest.on("host-left", () => seen.push("host-left"));
      guest.on("closed", (e: { reason: string }) => seen.push(`closed:${e.reason}`));
      await hostRoom.leave();
      await until(() => seen.length === 2 && mem.state.rooms.size === 0);
      expect(seen).toEqual(["host-left", "closed:host-left"]);
    },
    20000,
  );
});
