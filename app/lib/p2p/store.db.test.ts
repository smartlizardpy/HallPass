/**
 * The P2P store's SQL against a REAL Postgres — opt-in, because it needs a
 * database with migration 040 applied. The fake-`sql` tests in store.test.ts
 * check statement shape; this one checks the statements actually run and mean
 * what they say (reserved words, CTE semantics, jsonb_to_recordset, json_agg).
 *
 *   P2P_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run app/lib/p2p/store.db.test.ts
 *
 * Refuses to run when DATABASE_URL is the same endpoint as PROD_DATABASE_URL.
 * Everything it creates is deleted afterwards.
 */

import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { neon } from "@neondatabase/serverless";
import { createP2PStore } from "./store";

const url = process.env.DATABASE_URL ?? "";
const endpoint = (u: string) => {
  try {
    return new URL(u).hostname.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return "";
  }
};
const isProd = !!process.env.PROD_DATABASE_URL && endpoint(url) === endpoint(process.env.PROD_DATABASE_URL);
const enabled = process.env.P2P_DB_TEST === "1" && !!url && !isProd;

describe.skipIf(!enabled)("p2p store against Postgres", () => {
  // The describe body runs even when skipped; never hand neon() an empty URL.
  const sql = neon(enabled ? url : "postgres://skipped@localhost/skipped");
  const store = createP2PStore(sql);
  const tag = randomBytes(4).toString("hex");
  const key = `test-${tag}`;
  const gameId = `p2p-db-test-${tag}`;
  const roomId = `room-${tag}`;
  const host = "hosthosthost";
  const guest = "guestguestgu";

  afterAll(async () => {
    await sql`DELETE FROM p2p_rooms WHERE game_id = ${gameId}`;
    await sql`DELETE FROM p2p_attempts WHERE key = ${key}`;
  });

  it("rate-limits, opens a room, refuses a duplicate code, and finds it for a join", async () => {
    expect(await store.allowAttempt(key, "create", true)).toBe(true);
    expect(await store.createRoom({ gameId, code: "K7QX", roomId, hostPeer: host, gameVersion: "1.2.0", relayOnly: false })).toBe(true);
    expect(
      await store.createRoom({ gameId, code: "K7QX", roomId: roomId + "b", hostPeer: host, gameVersion: "1", relayOnly: false }),
    ).toBe(false);
    const found = await store.lookupForJoin(gameId, "K7QX", key);
    expect(found.room).toEqual({ roomId, hostPeer: host, gameVersion: "1.2.0", relayOnly: false, locked: false, full: false });
    expect((await store.lookupForJoin(gameId, "ZZZZ", key)).room).toBeNull();
  });

  it("counts attempts against the limit", async () => {
    for (let i = 0; i < 3; i++) await store.recordJoin(key, "miss");
    const { misses } = await store.lookupForJoin(gameId, "ZZZZ", key);
    expect(misses).toBe(3);
  });

  it("delivers a join to the host, acknowledges, sends and reads in one poll", async () => {
    await store.recordJoin(key, "join", { roomId, to: host, from: guest, body: { k: "join", name: "Ana", v: "1.2.0" } });
    const first = await store.poll({ roomId, peerId: host, isHost: true, after: 0, outgoing: [], state: { locked: true, full: false } });
    expect(first.alive).toBe(true);
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0]).toMatchObject({ from: guest, data: { k: "join", name: "Ana", v: "1.2.0" } });
    expect((await store.lookupForJoin(gameId, "K7QX", key)).room?.locked).toBe(true);

    const cursor = first.messages[0].id;
    const second = await store.poll({
      roomId,
      peerId: host,
      isHost: true,
      after: cursor,
      outgoing: [{ to: guest, body: { k: "rtc", d: { type: "answer", sdp: "v=0" } } }],
      state: { locked: false, full: true },
    });
    expect(second.messages).toEqual([]);
    const guestPoll = await store.poll({ roomId, peerId: guest, isHost: false, after: 0, outgoing: [] });
    expect(guestPoll.messages.map((m) => m.data)).toEqual([{ k: "rtc", d: { type: "answer", sdp: "v=0" } }]);
    const rows = await sql`SELECT count(*)::int AS n FROM p2p_signals WHERE room_id = ${roomId} AND to_peer = ${host}`;
    expect(rows[0].n).toBe(0); // acknowledged rows are gone
    expect((await store.lookupForJoin(gameId, "K7QX", key)).room).toMatchObject({ locked: false, full: true });
  });

  it("reports a closed room as not alive and drops its signals", async () => {
    await store.closeRoom(roomId, host);
    const after = await store.poll({ roomId, peerId: guest, isHost: false, after: 0, outgoing: [{ to: host, body: { k: "x" } }] });
    expect(after).toEqual({ alive: false, messages: [] });
    const rows = await sql`SELECT count(*)::int AS n FROM p2p_signals WHERE room_id = ${roomId}`;
    expect(rows[0].n).toBe(0);
  });
});
