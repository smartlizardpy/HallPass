-- HallPass — P2P signaling: canonical fresh-install DDL.
--
-- Mirrors migrations/040_p2p_signaling.sql (which carries the reasoning); keep
-- the two in lockstep.


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

