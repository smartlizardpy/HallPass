/**
 * The P2P signaling store, against the fake-`sql` seam `challenges/store.test.ts`
 * uses: every operation must be ONE statement (the `neon()` HTTP driver cannot
 * make two calls atomic), and caller input must only ever be a bound value.
 */

import { describe, expect, it } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createP2PStore } from "./store";
import { MAX_PENDING_PER_ROOM, RATE_LIMITS, ROOM_TTL_SECONDS } from "./config";

interface RecordedCall {
  text: string;
  values: unknown[];
}

function makeFakeSql(rows: Record<string, unknown>[] = []) {
  const calls: RecordedCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  };
  return { sql: fn as unknown as NeonQueryFunction<false, false>, calls };
}

describe("allowAttempt", () => {
  it("counts and records in one statement, and reports the outcome", async () => {
    const { sql, calls } = makeFakeSql([{ allowed: "1" }]);
    expect(await createP2PStore(sql).allowAttempt("k", "join")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("INSERT INTO p2p_attempts");
    expect(calls[0].values).toContain(RATE_LIMITS.join.maxPerWindow);
    expect(calls[0].values).toContain("k");
  });

  it("is refused when nothing was inserted", async () => {
    const { sql } = makeFakeSql([{ allowed: "0" }]);
    expect(await createP2PStore(sql).allowAttempt("k", "create")).toBe(false);
  });

  it("collects expired rows in the same statement when asked", async () => {
    const { sql, calls } = makeFakeSql([{ allowed: 1 }]);
    await createP2PStore(sql).allowAttempt("k", "create", true);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("DELETE FROM p2p_rooms");
    expect(calls[0].text).toContain("DELETE FROM p2p_signals");
    expect(calls[0].values).toContain(ROOM_TTL_SECONDS);
  });
});

describe("createRoom", () => {
  it("never overwrites a live room", async () => {
    const { sql, calls } = makeFakeSql([]);
    const ok = await createP2PStore(sql).createRoom({
      gameId: "g",
      code: "K7QX",
      roomId: "r",
      hostPeer: "abcdefghijkl",
      gameVersion: "1",
      relayOnly: false,
    });
    expect(ok).toBe(false);
    expect(calls[0].text).toContain("ON CONFLICT (game_id, code) DO NOTHING");
  });
});

describe("lookupForJoin", () => {
  it("maps a live room and the attempt counts", async () => {
    const { sql, calls } = makeFakeSql([
      {
        joins: "2",
        misses: "5",
        room_id: "r1",
        host_peer: "hostpeerabcd",
        game_version: "1.2.0",
        relay_only: true,
        is_locked: false,
        is_full: true,
      },
    ]);
    const res = await createP2PStore(sql).lookupForJoin("last-bell", "K7QX", "key");
    expect(calls).toHaveLength(1);
    expect(res).toEqual({
      joins: 2,
      misses: 5,
      room: { roomId: "r1", hostPeer: "hostpeerabcd", gameVersion: "1.2.0", relayOnly: true, locked: false, full: true },
    });
  });

  it("returns a null room when the LEFT JOIN found nothing", async () => {
    const { sql } = makeFakeSql([{ joins: "0", misses: "0", room_id: null }]);
    expect((await createP2PStore(sql).lookupForJoin("g", "AAAA", "k")).room).toBeNull();
  });
});

describe("recordJoin", () => {
  it("records the attempt and queues the join signal together, capped per room", async () => {
    const { sql, calls } = makeFakeSql();
    await createP2PStore(sql).recordJoin("k", "join", {
      roomId: "r",
      to: "host",
      from: "me",
      body: { k: "join", name: "Ana" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("INSERT INTO p2p_attempts");
    expect(calls[0].text).toContain("INSERT INTO p2p_signals");
    expect(calls[0].values).toContain(JSON.stringify({ k: "join", name: "Ana" }));
    expect(calls[0].values).toContain(MAX_PENDING_PER_ROOM);
  });
});

describe("poll", () => {
  it("acknowledges, sends and reads in ONE statement", async () => {
    const { sql, calls } = makeFakeSql([
      { alive: true, sent: "1", inbox: [{ id: "7", from: "abc", data: { k: "sdp" } }] },
    ]);
    const res = await createP2PStore(sql).poll({
      roomId: "r",
      peerId: "me",
      isHost: true,
      after: 6,
      outgoing: [{ to: "abc", body: { k: "ice" } }],
      state: { locked: true, full: false },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("DELETE FROM p2p_signals");
    expect(calls[0].text).toContain("INSERT INTO p2p_signals");
    expect(calls[0].text).toContain("UPDATE p2p_rooms");
    expect(calls[0].values).toContain(JSON.stringify([{ to_peer: "abc", body: { k: "ice" } }]));
    expect(res).toEqual({ alive: true, messages: [{ id: 7, from: "abc", data: { k: "sdp" } }] });
  });

  it("reports a dead room", async () => {
    const { sql } = makeFakeSql([{ alive: false, sent: "0", inbox: [] }]);
    const res = await createP2PStore(sql).poll({ roomId: "r", peerId: "me", isHost: false, after: 0, outgoing: [] });
    expect(res).toEqual({ alive: false, messages: [] });
  });
});
