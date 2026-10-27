-- HallPass — migration: BoardPass (PIN sign-in for shared school boards).
--
-- See `app/lib/boardpass/schema.sql` for the canonical DDL and commentary; keep
-- the two in lockstep. Fully idempotent; whole file in one transaction. Touches
-- no existing table.

BEGIN;


-- One credential per player. Disabling BoardPass DELETES the row. The PIN is
-- stored as a versioned Argon2id string over HMAC(pepper, playerId:pin); see
-- `pin.ts`. `pin_version` bumps on every change and is how already-joined board
-- participants are cut off the moment the PIN changes.
CREATE TABLE IF NOT EXISTS boardpass_credentials (
  player_id      TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  pin_hash       TEXT NOT NULL,
  pin_version    INTEGER NOT NULL DEFAULT 1,
  failed_count   INTEGER NOT NULL DEFAULT 0,
  last_failed_at TIMESTAMPTZ,
  locked_until   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ
);

-- A temporary browser-level session. Created only AFTER a successful PIN check,
-- so there is no empty-session spam. The cookie carries 32 random bytes; only
-- their SHA-256 is stored. `participant_count` is the serialisation point for
-- joins (an UPDATE on this row takes the row lock) and is capped at 8.
-- `active_*` is the player chosen for the game currently open; credit is bound to
-- that player AND that game slug.
CREATE TABLE IF NOT EXISTS boardpass_sessions (
  id                    UUID PRIMARY KEY,
  token_hash            TEXT NOT NULL UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  idle_expires_at       TIMESTAMPTZ NOT NULL,
  absolute_expires_at   TIMESTAMPTZ NOT NULL,
  ended_at              TIMESTAMPTZ,
  participant_count     SMALLINT NOT NULL DEFAULT 0
                          CONSTRAINT boardpass_sessions_count_chk CHECK (participant_count BETWEEN 0 AND 8),
  active_participant_id UUID,
  active_game_slug      TEXT,
  active_since          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS boardpass_sessions_absolute_idx
  ON boardpass_sessions (absolute_expires_at);

-- Who is in a session. A player may appear once per session while not revoked.
CREATE TABLE IF NOT EXISTS boardpass_participants (
  id          UUID PRIMARY KEY,
  session_id  UUID NOT NULL REFERENCES boardpass_sessions(id) ON DELETE CASCADE,
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  pin_version INTEGER NOT NULL,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS boardpass_participants_live_uniq
  ON boardpass_participants (session_id, player_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS boardpass_participants_session_idx
  ON boardpass_participants (session_id);
CREATE INDEX IF NOT EXISTS boardpass_participants_player_idx
  ON boardpass_participants (player_id);

-- Throttle windows for login attempts: `ip:<hash>` and `ipu:<hash>:<usernameHash>`.
-- Never holds a PIN or a raw IP. Old windows are deleted opportunistically.
CREATE TABLE IF NOT EXISTS boardpass_attempts (
  bucket_key   TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

COMMIT;
