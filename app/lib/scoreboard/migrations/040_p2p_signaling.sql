-- HallPass — migration: signaling storage for the P2P co-op SDK.
--
-- See `app/lib/p2p/schema.sql` for the canonical fresh-install DDL; keep the two
-- in lockstep. `docs/p2p-design.md` has the whole argument.
--
-- WHY A DATABASE AT ALL. Two browsers that want a WebRTC connection must swap a
-- few kilobytes of SDP before they can talk directly. HallPass runs on stateless
-- serverless functions with no WebSocket server, so the swap is a mailbox: one
-- side writes a row, the other polls for it. Only that handshake (and a
-- reconnect after a network blip) touches these tables. Game traffic never
-- does — it flows peer to peer.
--
-- EVERYTHING HERE IS SHORT-LIVED.
--   * `p2p_rooms`    one row per open room, alive while its host keeps polling
--                    (`host_seen_at`). A row the host abandoned for 180 s is
--                    treated as gone and deleted by the next room creation.
--   * `p2p_signals`  one row per signaling message (an SDP offer/answer, an ICE
--                    candidate, a join request). Deleted when the recipient
--                    acknowledges it, cascaded away with its room, and
--                    garbage-collected after 10 minutes regardless.
--   * `p2p_attempts` one row per rate-limited action, keyed by a SALTED HASH of
--                    the player id (signed in) or IP (guest) — never the raw
--                    value. Collected after an hour.
--
-- WHAT IS NOT STORED. No account ids, emails or IPs. A join request carries the
-- player's public display name and the game version until the host reads it.
-- SDP does contain the peers' candidate addresses — the same addresses the two
-- peers are about to learn from each other anyway — and lives seconds.
--
-- `code` is the 4-character room code from the unambiguous alphabet
-- ABCDEFGHJKLMNPQRSTUVWXYZ23456789. Codes are scoped per game, so the key is
-- (game_id, code). `room_id` is a random id minted per room INSTANCE: signaling
-- tokens are bound to it, so a code that is reused after a room closes can never
-- reach the previous room's mailbox.
--
-- Fully idempotent — whole file in one transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS p2p_rooms (
  game_id      TEXT        NOT NULL,
  code         TEXT        NOT NULL CHECK (code ~ '^[A-HJ-NP-Z2-9]{4}$'),
  room_id      TEXT        NOT NULL UNIQUE,
  host_peer    TEXT        NOT NULL,
  game_version TEXT        NOT NULL DEFAULT '',
  relay_only   BOOLEAN     NOT NULL DEFAULT false,
  -- The host's last reported lobby state, so a join to a locked or full room is
  -- refused without waking the host. The host re-checks every join anyway.
  locked       BOOLEAN     NOT NULL DEFAULT false,
  full         BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  host_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, code)
);

-- Garbage collection scans abandoned rooms by heartbeat age.
CREATE INDEX IF NOT EXISTS p2p_rooms_seen_idx ON p2p_rooms (host_seen_at);

CREATE TABLE IF NOT EXISTS p2p_signals (
  id         BIGSERIAL   PRIMARY KEY,
  room_id    TEXT        NOT NULL REFERENCES p2p_rooms(room_id) ON DELETE CASCADE,
  to_peer    TEXT        NOT NULL,
  from_peer  TEXT        NOT NULL,
  body       JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A poll reads one recipient's inbox in id order.
CREATE INDEX IF NOT EXISTS p2p_signals_inbox_idx ON p2p_signals (room_id, to_peer, id);
CREATE INDEX IF NOT EXISTS p2p_signals_age_idx ON p2p_signals (created_at);

CREATE TABLE IF NOT EXISTS p2p_attempts (
  key        TEXT        NOT NULL,
  kind       TEXT        NOT NULL CHECK (kind IN ('create', 'join', 'miss', 'ice')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS p2p_attempts_key_idx ON p2p_attempts (key, kind, created_at);
CREATE INDEX IF NOT EXISTS p2p_attempts_age_idx ON p2p_attempts (created_at);

COMMIT;
