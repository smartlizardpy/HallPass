-- HallPass — one-time migration: player identity tagging on scores.
--
-- Adds the `players` table (verified Google identities, keyed by the Google
-- subject id) and links scores to it via a nullable `scores.player_id`. Existing
-- scores stay ANONYMOUS (player_id NULL); ON DELETE SET NULL means deleting a
-- player de-tags but never destroys their historical scores. See `players.sql`
-- for the canonical players DDL and `schema.sql` for the fresh-install scores.
--
-- RUN ONCE, inside a single transaction (Neon DDL is transactional). This file
-- is intentionally NOT idempotent: `ADD CONSTRAINT scores_player_id_fkey` has no
-- IF NOT EXISTS. Do not re-run it. Fresh databases should use `schema.sql` plus
-- `players.sql` instead.

BEGIN;

-- 1. players — verified Google identities (mirror of players.sql).
CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  image       TEXT,
  handle      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login  TIMESTAMPTZ
);

-- 2. scores.player_id — nullable link to a verified player (anonymous when NULL).
ALTER TABLE scores ADD COLUMN IF NOT EXISTS player_id TEXT;
ALTER TABLE scores ADD CONSTRAINT scores_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL;

-- 3. Index for player-scoped reads (a player's own scores, joins on read).
CREATE INDEX IF NOT EXISTS idx_scores_player ON scores (player_id);

COMMIT;
