-- HallPass Scoreboard — one-time migration: decouple boards from games.
--
-- Transforms the original slug-keyed schema (boards.slug PK == game slug,
-- scores.slug FK) into the decoupled shape: boards have their own `id` plus an
-- optional `game_slug` link, and scores reference `board_id`. Every existing
-- board's identity equals its game today, so we backfill id = game_slug = old
-- slug, preserving all current public leaderboard URLs.
--
-- RUN ONCE, inside a single transaction (Neon DDL is transactional). This file
-- is intentionally NOT idempotent: `ADD CONSTRAINT` has no IF NOT EXISTS. Do not
-- re-run it. Fresh databases should use `schema.sql` instead.

BEGIN;

-- 1. boards.id — backfill from the old slug, then make it the not-null identity.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS id TEXT;
UPDATE boards SET id = slug WHERE id IS NULL;
ALTER TABLE boards ALTER COLUMN id SET NOT NULL;

-- 2. boards.game_slug — every existing board IS its game, so link them.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS game_slug TEXT;
UPDATE boards SET game_slug = slug WHERE game_slug IS NULL;

-- 3. scores.board_id — backfill from the FK'd slug (no orphans possible today).
ALTER TABLE scores ADD COLUMN IF NOT EXISTS board_id TEXT;
UPDATE scores SET board_id = slug WHERE board_id IS NULL;

-- 4. Drop the old FK FIRST — boards' PK cannot be dropped while referenced.
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_slug_fkey;

-- 5. Swap the boards primary key from slug to id.
ALTER TABLE boards DROP CONSTRAINT boards_pkey;
ALTER TABLE boards ADD PRIMARY KEY (id);
ALTER TABLE boards ADD CONSTRAINT boards_id_format CHECK (id ~ '^[a-z0-9][a-z0-9-]*$');

-- 6. Make scores.board_id the not-null FK to boards(id).
ALTER TABLE scores ALTER COLUMN board_id SET NOT NULL;
ALTER TABLE scores ADD CONSTRAINT scores_board_id_fkey
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE;

-- 7. Rebuild indexes around board_id; drop the old slug-keyed ones.
DROP INDEX IF EXISTS idx_scores_slug_desc;
DROP INDEX IF EXISTS idx_scores_slug_asc;
DROP INDEX IF EXISTS idx_scores_slug_created;
CREATE INDEX IF NOT EXISTS idx_scores_board_desc ON scores (board_id, score DESC, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_scores_board_asc  ON scores (board_id, score ASC, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_scores_board_created ON scores (board_id, created_at DESC);

-- 8. Drop the now-redundant slug columns (id replaces them).
ALTER TABLE scores DROP COLUMN IF EXISTS slug;
ALTER TABLE boards DROP COLUMN IF EXISTS slug;

COMMIT;
