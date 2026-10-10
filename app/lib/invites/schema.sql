-- HallPass — game invites: canonical fresh-install DDL.
--
-- Mirrors migrations/041_game_invites.sql (which carries the reasoning); keep
-- the two in lockstep. Requires `players` (players.sql).

CREATE TABLE IF NOT EXISTS game_invites (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        TEXT        NOT NULL UNIQUE
                          CHECK (code ~ '^[0-9CDFGHJKMNPQRTVWXY]{12}$'),
  slug        TEXT        NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  kind        TEXT        NOT NULL CHECK (kind IN ('friend', 'link')),
  data        JSONB       NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  from_player TEXT        REFERENCES players(id) ON DELETE CASCADE,
  to_player   TEXT        REFERENCES players(id) ON DELETE CASCADE,
  sender_key  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  CONSTRAINT game_invites_friend_shape_chk
    CHECK (kind <> 'friend' OR (from_player IS NOT NULL AND to_player IS NOT NULL)),
  CONSTRAINT game_invites_link_shape_chk
    CHECK (kind <> 'link' OR to_player IS NULL),
  CONSTRAINT game_invites_sender_chk
    CHECK (from_player IS NOT NULL OR sender_key IS NOT NULL),
  CONSTRAINT game_invites_expiry_chk CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS game_invites_expires_idx ON game_invites (expires_at);

CREATE INDEX IF NOT EXISTS game_invites_sender_idx
  ON game_invites (from_player, kind, created_at)
  WHERE from_player IS NOT NULL;

CREATE INDEX IF NOT EXISTS game_invites_guest_idx
  ON game_invites (sender_key, created_at)
  WHERE sender_key IS NOT NULL;
