/**
 * HallPass P2P — signaling store (factory).
 *
 * Same seam as `challenges/store.ts`: the factory takes the tagged-template
 * `sql` so tests can hand it a fake that records the emitted SQL. No
 * `server-only` here; `index.ts` binds the live Neon client.
 *
 * ONE STATEMENT PER OPERATION. The `neon()` HTTP driver cannot hold a
 * transaction across calls, so anything that must be atomic — "count recent
 * attempts and record this one", "acknowledge, send and read in one poll" — is a
 * single statement built from data-modifying CTEs. A poll is the hot path (a
 * host polls about once a second while its lobby is open), so it is exactly one
 * round trip.
 *
 * Every write throws on failure; the routes decide between a 503 (missing
 * table, unconfigured database) and a 500.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  ATTEMPT_TTL_SECONDS,
  MAX_PENDING_PER_ROOM,
  MAX_SIGNALS_PER_POLL,
  RATE_LIMITS,
  ROOM_TTL_SECONDS,
  SIGNAL_TTL_SECONDS,
  type AttemptKind,
} from "./config";

type Sql = NeonQueryFunction<false, false>;

export interface RoomRow {
  roomId: string;
  hostPeer: string;
  gameVersion: string;
  relayOnly: boolean;
  locked: boolean;
  full: boolean;
}

export interface InboxMessage {
  id: number;
  from: string;
  data: unknown;
}

export interface OutgoingSignal {
  to: string;
  body: unknown;
}

const toInt = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function createP2PStore(sql: Sql) {
  return {
    /**
     * Count `kind` attempts by `key` in its window and, when under the limit,
     * record this one — atomically. Also collects expired rooms, signals and
     * attempts: room creation is rare and frequent enough to be the janitor,
     * and every delete is on an indexed timestamp.
     *
     * Returns `true` when the action may proceed.
     */
    async allowAttempt(key: string, kind: AttemptKind, collect = false): Promise<boolean> {
      const { maxPerWindow, windowSeconds } = RATE_LIMITS[kind];
      const rows = collect
        ? await sql`
            WITH gc_rooms AS (
              DELETE FROM p2p_rooms
               WHERE host_seen_at < now() - make_interval(secs => ${ROOM_TTL_SECONDS})
            ),
            gc_signals AS (
              DELETE FROM p2p_signals
               WHERE created_at < now() - make_interval(secs => ${SIGNAL_TTL_SECONDS})
            ),
            gc_attempts AS (
              DELETE FROM p2p_attempts
               WHERE created_at < now() - make_interval(secs => ${ATTEMPT_TTL_SECONDS})
            ),
            recent AS (
              SELECT count(*) AS n FROM p2p_attempts
               WHERE key = ${key} AND kind = ${kind}
                 AND created_at >= now() - make_interval(secs => ${windowSeconds})
            ),
            ins AS (
              INSERT INTO p2p_attempts (key, kind)
              SELECT ${key}, ${kind} WHERE (SELECT n FROM recent) < ${maxPerWindow}
              RETURNING 1
            )
            SELECT (SELECT count(*) FROM ins) AS allowed`
        : await sql`
            WITH recent AS (
              SELECT count(*) AS n FROM p2p_attempts
               WHERE key = ${key} AND kind = ${kind}
                 AND created_at >= now() - make_interval(secs => ${windowSeconds})
            ),
            ins AS (
              INSERT INTO p2p_attempts (key, kind)
              SELECT ${key}, ${kind} WHERE (SELECT n FROM recent) < ${maxPerWindow}
              RETURNING 1
            )
            SELECT (SELECT count(*) FROM ins) AS allowed`;
      return toInt(rows[0]?.allowed) > 0;
    },

    /**
     * Open a room under `code`. Returns `false` when a live room already holds
     * that code (the caller retries with another). Expired rooms were collected
     * by `allowAttempt(..., collect = true)` just before.
     */
    async createRoom(r: {
      gameId: string;
      code: string;
      roomId: string;
      hostPeer: string;
      gameVersion: string;
      relayOnly: boolean;
    }): Promise<boolean> {
      const rows = await sql`
        INSERT INTO p2p_rooms (game_id, code, room_id, host_peer, game_version, relay_only)
        VALUES (${r.gameId}, ${r.code}, ${r.roomId}, ${r.hostPeer}, ${r.gameVersion}, ${r.relayOnly})
        ON CONFLICT (game_id, code) DO NOTHING
        RETURNING room_id`;
      return rows.length > 0;
    },

    /**
     * Everything a join needs to decide, in one read: the caller's recent join
     * and miss counts, and the live room under (gameId, code) if there is one.
     */
    async lookupForJoin(
      gameId: string,
      code: string,
      key: string,
    ): Promise<{ joins: number; misses: number; room: RoomRow | null }> {
      const rows = await sql`
        SELECT
          (SELECT count(*) FROM p2p_attempts
            WHERE key = ${key} AND kind = 'join'
              AND created_at >= now() - make_interval(secs => ${RATE_LIMITS.join.windowSeconds})) AS joins,
          (SELECT count(*) FROM p2p_attempts
            WHERE key = ${key} AND kind = 'miss'
              AND created_at >= now() - make_interval(secs => ${RATE_LIMITS.miss.windowSeconds})) AS misses,
          r.room_id, r.host_peer, r.game_version, r.relay_only, r.is_locked, r.is_full
        FROM (SELECT 1) AS one
        LEFT JOIN p2p_rooms r
          ON r.game_id = ${gameId} AND r.code = ${code}
         AND r.host_seen_at >= now() - make_interval(secs => ${ROOM_TTL_SECONDS})`;
      const row = rows[0] ?? {};
      return {
        joins: toInt(row.joins),
        misses: toInt(row.misses),
        room:
          row.room_id == null
            ? null
            : {
                roomId: String(row.room_id),
                hostPeer: String(row.host_peer),
                gameVersion: String(row.game_version ?? ""),
                relayOnly: row.relay_only === true,
                locked: row.is_locked === true,
                full: row.is_full === true,
              },
      };
    },

    /** Record a join attempt and, when `signal` is given, queue it for the host. */
    async recordJoin(
      key: string,
      kind: "join" | "miss",
      signal?: { roomId: string; to: string; from: string; body: unknown },
    ): Promise<void> {
      if (!signal) {
        await sql`INSERT INTO p2p_attempts (key, kind) VALUES (${key}, ${kind})`;
        return;
      }
      await sql`
        WITH att AS (
          INSERT INTO p2p_attempts (key, kind) VALUES (${key}, ${kind})
        )
        INSERT INTO p2p_signals (room_id, to_peer, from_peer, body)
        SELECT ${signal.roomId}, ${signal.to}, ${signal.from}, ${JSON.stringify(signal.body)}::jsonb
        WHERE (SELECT count(*) FROM p2p_signals WHERE room_id = ${signal.roomId}) < ${MAX_PENDING_PER_ROOM}`;
    },

    /**
     * One poll: acknowledge everything up to `after`, send `outgoing`, refresh
     * the host's heartbeat and lobby state, and read the inbox. One statement.
     *
     * The final SELECT runs on the statement's snapshot, so it does not see the
     * rows this same statement deletes (all `<= after`, excluded anyway) or
     * inserts (addressed to other peers).
     */
    async poll(p: {
      roomId: string;
      peerId: string;
      isHost: boolean;
      after: number;
      outgoing: OutgoingSignal[];
      state?: { locked: boolean; full: boolean } | null;
    }): Promise<{ alive: boolean; messages: InboxMessage[] }> {
      const outgoing = JSON.stringify(p.outgoing.map((m) => ({ to_peer: m.to, body: m.body })));
      const locked = p.state ? p.state.locked : null;
      const full = p.state ? p.state.full : null;
      const rows = await sql`
        WITH room AS (
          SELECT room_id FROM p2p_rooms WHERE room_id = ${p.roomId}
        ),
        beat AS (
          UPDATE p2p_rooms
             SET host_seen_at = now(),
                 is_locked = COALESCE(${locked}::boolean, is_locked),
                 is_full = COALESCE(${full}::boolean, is_full)
           WHERE room_id = ${p.roomId} AND ${p.isHost}::boolean
        ),
        acked AS (
          DELETE FROM p2p_signals
           WHERE room_id = ${p.roomId} AND to_peer = ${p.peerId} AND id <= ${p.after}
        ),
        sent AS (
          INSERT INTO p2p_signals (room_id, to_peer, from_peer, body)
          SELECT ${p.roomId}, x.to_peer, ${p.peerId}, x.body
            FROM jsonb_to_recordset(${outgoing}::jsonb) AS x(to_peer text, body jsonb)
           WHERE EXISTS (SELECT 1 FROM room)
             AND (SELECT count(*) FROM p2p_signals WHERE room_id = ${p.roomId}) < ${MAX_PENDING_PER_ROOM}
          RETURNING 1
        )
        SELECT
          EXISTS (SELECT 1 FROM room) AS alive,
          (SELECT count(*) FROM sent) AS sent,
          COALESCE((
            SELECT json_agg(json_build_object('id', s.id, 'from', s.from_peer, 'data', s.body) ORDER BY s.id)
              FROM (
                SELECT id, from_peer, body FROM p2p_signals
                 WHERE room_id = ${p.roomId} AND to_peer = ${p.peerId} AND id > ${p.after}
                 ORDER BY id
                 LIMIT ${MAX_SIGNALS_PER_POLL}
              ) AS s
          ), '[]'::json) AS inbox`;
      const row = rows[0] ?? {};
      const inbox = Array.isArray(row.inbox) ? (row.inbox as Record<string, unknown>[]) : [];
      return {
        alive: row.alive === true,
        messages: inbox.map((m) => ({ id: toInt(m.id), from: String(m.from), data: m.data })),
      };
    },

    /** The host closed the room: drop it (its signals cascade). */
    async closeRoom(roomId: string, hostPeer: string): Promise<void> {
      await sql`DELETE FROM p2p_rooms WHERE room_id = ${roomId} AND host_peer = ${hostPeer}`;
    },

    /** The raw fields `publicDisplayName()` needs, or `null` for an unknown player. */
    async playerNameFields(
      playerId: string,
    ): Promise<{ handle: string | null; username: string | null; image: string | null } | null> {
      const rows = await sql`SELECT handle, username, image FROM players WHERE id = ${playerId}`;
      if (!rows.length) return null;
      const r = rows[0];
      return {
        handle: r.handle == null ? null : String(r.handle),
        username: r.username == null ? null : String(r.username),
        image: r.image == null ? null : String(r.image),
      };
    },
  };
}

export type P2PStore = ReturnType<typeof createP2PStore>;
