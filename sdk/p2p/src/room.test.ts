/**
 * Room behaviour end to end over the REAL local transport (Node's
 * BroadcastChannel) with an in-memory RTCPeerConnection: the scenarios of the
 * brief's section 6 that do not need a real browser.
 *
 * Each test uses its own gameId so BroadcastChannel traffic never crosses tests.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env } from "./env";
import { connect } from "./client";
import type { Client, ConnectOptions, Player, Room } from "./types";
import { FakePC, installFakeRTC, net } from "../test/fake-rtc";

beforeAll(() => installFakeRTC(env));

let open: Client[] = [];
let gameSeq = 0;

afterEach(async () => {
  await Promise.all(open.map((c) => c.close().catch(() => {})));
  open = [];
  net.reset();
});

async function client(gameId: string, name: string, extra: Partial<ConnectOptions> = {}): Promise<Client> {
  const c = await connect({ gameId, gameVersion: "1.0.0", name, transport: "local", ...extra });
  open.push(c);
  return c;
}

const newGame = () => `test-game-${++gameSeq}-${Date.now()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms = 4000, what = "condition"): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting for " + what);
    await sleep(10);
  }
}

/** A host plus `n` joined guests. */
async function room(n: number, opts: { max?: number; lockOnStart?: boolean; extra?: Partial<ConnectOptions> } = {}) {
  const game = newGame();
  const host = await client(game, "Host", opts.extra);
  const hostRoom = await host.createRoom({ maxPlayers: opts.max ?? 4, meta: { difficulty: "normal" }, lockOnStart: opts.lockOnStart });
  const guests: Room[] = [];
  for (let i = 0; i < n; i++) {
    const g = await client(game, `Guest ${i + 1}`, opts.extra);
    guests.push(await g.joinRoom(hostRoom.code));
  }
  const all = [hostRoom, ...guests];
  await until(() => all.every((r) => r.players.length === n + 1), 4000, "everyone to see everyone");
  return { game, host: hostRoom, guests, all };
}

const ids = (r: Room) => r.players.map((p: Player) => p.id).sort();

describe("forming a room", () => {
  it("host + 3 joiners all see the same player list", async () => {
    const { host, guests, all } = await room(3);
    for (const r of all) {
      expect(ids(r)).toEqual(ids(host));
      expect(r.hostId).toBe(host.selfId);
      expect(r.code).toBe(host.code);
      expect(r.players.find((p) => p.isSelf)!.id).toBe(r.selfId);
      expect(r.players.filter((p) => p.isHost)).toHaveLength(1);
      expect(r.meta).toEqual({ difficulty: "normal" });
    }
    expect(guests[2].players.map((p) => p.name).sort()).toEqual(["Guest 1", "Guest 2", "Guest 3", "Host"]);
    await until(() => all.every((r) => r.players.every((p) => p.connection.state === "connected")), 4000, "full mesh");
  });

  it("raises player-join on existing players", async () => {
    const { game, host, guests } = await room(1);
    const joins: string[] = [];
    host.on("player-join", (p: Player) => joins.push(`host:${p.name}`));
    guests[0].on("player-join", (p: Player) => joins.push(`g1:${p.name}`));
    const c = await client(game, "Late");
    const late = await c.joinRoom(host.code);
    await until(() => joins.length === 2);
    expect(joins.sort()).toEqual(["g1:Late", "host:Late"]);
    expect(late.players).toHaveLength(3);
  });

  it("refuses a 5th player in a 4-player room with room-full", async () => {
    const { game, host } = await room(3, { max: 4 });
    const c = await client(game, "Fifth");
    await expect(c.joinRoom(host.code)).rejects.toMatchObject({ code: "room-full" });
  });

  it("refuses joins to a locked room, a started lockOnStart room, and the wrong version", async () => {
    const { game, host } = await room(0, { lockOnStart: true });
    host.lock();
    const a = await client(game, "A");
    await expect(a.joinRoom(host.code)).rejects.toMatchObject({ code: "room-locked" });
    host.unlock();
    host.start({ seed: 1 });
    const b = await client(game, "B");
    await expect(b.joinRoom(host.code)).rejects.toMatchObject({ code: "room-locked" });

    const { game: game2, host: host2 } = await room(0);
    const old = await client(game2, "Old", { gameVersion: "0.9.0" });
    const err = await old.joinRoom(host2.code).catch((e) => e);
    expect(err.code).toBe("version-mismatch");
    expect(err.message).toContain("1.0.0");
  });

  it("reports an unknown code as room-not-found", async () => {
    const c = await client(newGame(), "Lost");
    await expect(c.joinRoom("ZZZZ")).rejects.toMatchObject({ code: "room-not-found" });
    await expect(c.joinRoom("bad!")).rejects.toMatchObject({ code: "room-not-found" });
  });

  it("allows only one room per client at a time", async () => {
    const { game } = await room(0);
    const c = await client(game, "Busy");
    await c.createRoom();
    await expect(c.createRoom()).rejects.toMatchObject({ code: "already-in-room" });
  });
});

describe("messages", () => {
  it(
    "delivers 1000 reliable messages per peer exactly once and in order under latency and jitter",
    async () => {
      const { all } = await room(3, { extra: { simulate: { latencyMs: 15, jitterMs: 25, lossPct: 50 } } });
      const N = 1000;
      const got = new Map<string, Map<string, number[]>>();
      for (const r of all) {
        const mine = new Map<string, number[]>();
        got.set(r.selfId, mine);
        r.on("seq", (n: number, meta) => {
          expect(meta.reliable).toBe(true);
          const list = mine.get(meta.from) ?? [];
          list.push(n);
          mine.set(meta.from, list);
        });
      }
      for (const r of all) for (let i = 0; i < N; i++) r.send("seq", i);
      await until(
        () => [...got.values()].every((m) => m.size === 3 && [...m.values()].every((l) => l.length >= N)),
        15000,
        "all messages",
      );
      await sleep(200);
      const expected = Array.from({ length: N }, (_, i) => i);
      for (const m of got.values()) for (const list of m.values()) expect(list).toEqual(expected);
    },
    20000,
  );

  it("sends unreliable messages under loss without throwing, and never retries them", async () => {
    const { host, guests } = await room(1, { extra: { simulate: { latencyMs: 5, jitterMs: 20, lossPct: 40 } } });
    const got: number[] = [];
    guests[0].on("pos", (n: number, meta) => {
      expect(meta.reliable).toBe(false);
      got.push(n);
    });
    for (let i = 0; i < 300; i++) host.send("pos", i, { reliable: false });
    await sleep(400);
    expect(got.length).toBeGreaterThan(100);
    expect(got.length).toBeLessThan(300);
    expect(new Set(got).size).toBe(got.length); // never duplicated
  });

  it("routes to 'all' (self included, asynchronously), 'host', one peer and a list", async () => {
    const { host, guests } = await room(2);
    const [a, b] = guests;
    const log: string[] = [];
    for (const r of [host, a, b]) r.on("hi", (d: string, meta) => log.push(`${r.selfId === host.selfId ? "H" : r === a ? "A" : "B"}<${d}:${meta.from === r.selfId ? "self" : "peer"}`));
    a.send("hi", "all", { to: "all" });
    expect(log).toEqual([]); // not synchronous
    await until(() => log.length === 3);
    a.send("hi", "host", { to: "host" });
    a.send("hi", "one", { to: b.selfId });
    a.send("hi", "list", { to: [host.selfId, b.selfId] });
    await until(() => log.length === 7).catch((e) => {
      throw new Error(e.message + " " + JSON.stringify(log));
    });
    expect(log.sort()).toEqual(
      ["A<all:self", "B<all:peer", "H<all:peer", "H<host:peer", "B<one:peer", "H<list:peer", "B<list:peer"].sort(),
    );
  });

  it("carries large reliable messages and binary data intact", async () => {
    const { host, guests } = await room(1);
    let big: string | null = null;
    let bin: Float32Array | null = null;
    guests[0].on("big", (d: string) => (big = d));
    guests[0].on("bin", (d: Float32Array) => (bin = d));
    host.send("big", "x".repeat(200_000));
    host.send("bin", new Float32Array([1, 2.5, -3]), { reliable: false });
    await until(() => big !== null && bin !== null);
    expect(big).toHaveLength(200_000);
    expect(Array.from(bin!)).toEqual([1, 2.5, -3]);
  });

  it("refuses oversized messages and reserved names with clear errors", async () => {
    const { host } = await room(0);
    expect(() => host.send("big", "x".repeat(300_000))).toThrow(expect.objectContaining({ code: "message-too-large" }));
    expect(() => host.send("pos", "x".repeat(20_000), { reliable: false })).toThrow(
      expect.objectContaining({ code: "message-too-large" }),
    );
    expect(() => host.send("start", 1)).toThrow(expect.objectContaining({ code: "invalid-argument" }));
  });
});

describe("request / handle", () => {
  it("returns the handler's value, times out without a handler, and reports handler errors", async () => {
    const { host, guests } = await room(1);
    host.handle("pickup", async (data: { itemId: string }, meta) => ({ ok: data.itemId === "fuse", from: meta.from }));
    host.handle("explode", () => {
      throw new Error("Door is jammed");
    });
    const g = guests[0];
    await expect(g.request("host", "pickup", { itemId: "fuse" }, { timeoutMs: 3000 })).resolves.toEqual({
      ok: true,
      from: g.selfId,
    });
    await expect(g.request("host", "nobody-handles-this", {}, { timeoutMs: 200 })).rejects.toMatchObject({ code: "timeout" });
    await expect(g.request(host.selfId, "explode")).rejects.toMatchObject({ code: "handler-error", message: "Door is jammed" });
    // The host can ask itself.
    await expect(host.request("host", "pickup", { itemId: "key" })).resolves.toEqual({ ok: false, from: host.selfId });
  });
});

describe("lobby", () => {
  it("replicates ready, player meta and room meta with update events", async () => {
    const { host, guests } = await room(1);
    const g = guests[0];
    const updates: string[] = [];
    host.on("player-update", (p: Player) => updates.push(`host saw ${p.name} ready=${p.ready} color=${p.meta.color}`));
    g.on("room-update", (r: Room) => updates.push(`guest saw meta ${JSON.stringify(r.meta)} locked=${r.locked}`));
    g.setReady(true);
    g.setPlayerMeta({ color: 2 });
    await until(() => host.players.find((p) => p.id === g.selfId)?.meta.color === 2);
    host.setRoomMeta({ difficulty: "hard" });
    host.lock();
    await until(() => g.locked && g.meta.difficulty === "hard");
    expect(host.players.find((p) => p.id === g.selfId)!.ready).toBe(true);
    expect(updates).toContain("host saw Guest 1 ready=true color=2");
    expect(updates.some((u) => u.startsWith('guest saw meta {"difficulty":"hard"}'))).toBe(true);
  });

  it("keeps host-only controls for the host", async () => {
    const { guests } = await room(1);
    const g = guests[0];
    expect(() => g.lock()).toThrow(expect.objectContaining({ code: "not-host" }));
    expect(() => g.start()).toThrow(expect.objectContaining({ code: "not-host" }));
    expect(() => g.kick("x")).toThrow(expect.objectContaining({ code: "not-host" }));
    expect(() => g.setRoomMeta({})).toThrow(expect.objectContaining({ code: "not-host" }));
  });

  it("start reaches everyone with one startAt, ~500 ms ahead on the shared clock, and locks with lockOnStart", async () => {
    const { host, all } = await room(2, { lockOnStart: true });
    await sleep(300); // let the clocks settle
    const starts: Array<{ payload: unknown; startAt: number; now: number }> = [];
    for (const r of all) r.on("start", (e: { payload: unknown; startAt: number }) => starts.push({ ...e, now: r.now() }));
    host.start({ seed: 123456 });
    await until(() => starts.length === 3);
    expect(new Set(starts.map((s) => s.startAt)).size).toBe(1);
    for (const s of starts) {
      expect(s.payload).toEqual({ seed: 123456 });
      expect(s.startAt - s.now).toBeGreaterThan(300);
      expect(s.startAt - s.now).toBeLessThanOrEqual(520);
    }
    await until(() => all.every((r) => r.started && r.locked));
  });

  it("agrees on room.now() across peers", async () => {
    const { all } = await room(3, { extra: { simulate: { latencyMs: 20, jitterMs: 5 } } });
    await sleep(1200);
    const values = all.map((r) => r.now());
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(20);
  });

  it("broadcasts visibility changes", async () => {
    const { host, guests } = await room(1);
    const seen: Array<{ id: string; hidden: boolean }> = [];
    host.on("visibility", (e: { id: string; hidden: boolean }) => seen.push(e));
    (guests[0] as unknown as { setHidden(h: boolean): void }).setHidden(true);
    await until(() => seen.length === 1);
    expect(seen[0]).toEqual({ id: guests[0].selfId, hidden: true });
    expect(host.players.find((p) => p.id === guests[0].selfId)!.hidden).toBe(true);
  });
});

describe("leaving, kicking, the host leaving", () => {
  it("kick removes the player for everyone and refuses their rejoin", async () => {
    const { game, host, guests } = await room(2);
    const [a, b] = guests;
    const events: string[] = [];
    a.on("kicked", (e: { reason: string }) => events.push(`kicked:${e.reason}`));
    a.on("closed", (e: { reason: string }) => events.push(`closed:${e.reason}`));
    b.on("player-leave", (e: { id: string; reason: string }) => events.push(`leave:${e.id === a.selfId}:${e.reason}`));
    host.kick(a.selfId, "griefing");
    await until(() => events.length === 3);
    expect(events).toEqual(["kicked:griefing", "closed:kicked", "leave:true:kicked"]);
    await until(() => host.players.length === 2 && b.players.length === 2);
    void game;
  });

  it("a guest leaving raises player-leave 'left'", async () => {
    const { host, guests } = await room(2);
    const left: string[] = [];
    host.on("player-leave", (e: { reason: string }) => left.push(e.reason));
    guests[1].on("player-leave", (e: { reason: string }) => left.push(e.reason));
    await guests[0].leave();
    await until(() => left.length === 2);
    expect(left).toEqual(["left", "left"]);
  });

  it("the host leaving gives everyone host-left then closed", async () => {
    const { host, guests } = await room(3);
    const seen: string[][] = guests.map(() => []);
    guests.forEach((g, i) => {
      g.on("host-left", () => seen[i].push("host-left"));
      g.on("closed", (e: { reason: string }) => seen[i].push(`closed:${e.reason}`));
    });
    await host.leave();
    await until(() => seen.every((s) => s.length === 2));
    for (const s of seen) expect(s).toEqual(["host-left", "closed:host-left"]);
  });

  it("the host leaving while a guest is mid-join rejects that join instead of hanging", async () => {
    const { game, host } = await room(0);
    const c = await client(game, "Midway");
    // The host leaves the instant the join request reaches it.
    const internals = host as unknown as { onJoin: (from: string, data: unknown) => void };
    const onJoin = internals.onJoin.bind(host);
    internals.onJoin = (from, data) => {
      onJoin(from, data);
      void host.leave();
    };
    const outcome = await c.joinRoom(host.code).then(
      () => null,
      (e: { code: string; reason?: string }) => e,
    );
    expect(outcome).toMatchObject({ code: "connect-failed", reason: "room-closed" });
  });

  it("reports a throwing handler as an 'error' event and keeps delivering", async () => {
    const { host, guests } = await room(1);
    const errors: Array<{ code: string; cause?: unknown }> = [];
    const got: number[] = [];
    host.on("error", (e: { code: string; cause?: unknown }) => errors.push(e));
    host.on("n", () => {
      throw new Error("game bug");
    });
    host.on("n", (n: number) => got.push(n));
    guests[0].send("n", 1);
    guests[0].send("n", 2);
    await until(() => got.length === 2 && errors.length === 2);
    expect(errors[0].code).toBe("handler-error");
    expect((errors[0].cause as Error).message).toBe("game bug");
  });

  it("a closed tab (no bye) is reported as 'disconnected'", async () => {
    const { host, guests } = await room(1);
    const left: string[] = [];
    host.on("player-leave", (e: { reason: string }) => left.push(e.reason));
    const link = (guests[0] as unknown as { links: Map<string, { pc: FakePC }> }).links.get(host.selfId)!;
    link.pc.close(); // the far side's channels close without a bye
    await until(() => left.length === 1);
    expect(left).toEqual(["disconnected"]);
  });
});

describe("reconnecting", () => {
  it(
    "recovers from a brief drop within 10 s and the room carries on",
    async () => {
      const { host, guests } = await room(2);
      const [a, b] = guests;
      const leaves: string[] = [];
      for (const r of [host, a, b]) r.on("player-leave", () => leaves.push("leave"));
      const states: string[] = [];
      host.on("player-update", (p: Player) => p.id === a.selfId && states.push(p.connection.state));

      const pcA = (a as unknown as { links: Map<string, { pc: FakePC }> }).links.get(host.selfId)!.pc;
      const pcAB = (a as unknown as { links: Map<string, { pc: FakePC }> }).links.get(b.selfId)!.pc;
      net.cut(pcA);
      net.cut(pcAB);
      await until(() => host.players.find((p) => p.id === a.selfId)!.connection.state === "reconnecting");
      await sleep(800);
      net.restore(pcA);
      net.restore(pcAB);
      await until(
        () =>
          host.players.find((p) => p.id === a.selfId)!.connection.state === "connected" &&
          b.players.find((p) => p.id === a.selfId)!.connection.state === "connected",
        10000,
        "reconnect",
      );
      expect(states).toContain("reconnecting");
      expect(leaves).toEqual([]);
      const got: string[] = [];
      b.on("after", (d: string) => got.push(d));
      a.send("after", "still here");
      await until(() => got.length === 1);
    },
    15000,
  );

  it(
    "gives up after 10 s with player-leave 'timeout'",
    async () => {
      const { host, guests } = await room(1);
      const left: string[] = [];
      host.on("player-leave", (e: { reason: string }) => left.push(e.reason));
      const closed: string[] = [];
      guests[0].on("closed", (e: { reason: string }) => closed.push(e.reason));
      const pc = (host as unknown as { links: Map<string, { pc: FakePC }> }).links.get(guests[0].selfId)!.pc;
      net.cut(pc);
      await until(() => left.length === 1, 13000, "timeout leave");
      expect(left).toEqual(["timeout"]);
      await until(() => closed.length === 1, 3000, "guest closed");
      expect(closed).toEqual(["timeout"]);
    },
    20000,
  );
});

describe("diagnostics", () => {
  it("reports per-peer stats", async () => {
    const { host, guests } = await room(1);
    await sleep(500);
    const stats = await host.stats();
    expect(Object.keys(stats)).toEqual([guests[0].selfId]);
    expect(stats[guests[0].selfId]).toMatchObject({ relay: false });
    expect(typeof stats[guests[0].selfId].rttMs).toBe("number");
  });
});
