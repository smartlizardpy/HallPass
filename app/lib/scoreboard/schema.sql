-- HallPass Scoreboard — canonical schema for a FRESH database.
--
-- A "board" is a leaderboard with its OWN identity (`id`) and an OPTIONAL link
-- to a game (`game_slug`). Decoupling identity from the game lets a board exist
-- standalone (linked later) and lets one game own several boards (e.g. a Score
-- board and a Time-Attack board). `game_slug` is intentionally NOT a foreign key
-- and NOT unique: games live in a static TS array (`app/lib/games.ts`), validated
-- in app code at write time, and multiple boards may point at the same game.
--
-- For an EXISTING database created under the old slug-keyed schema, run the
-- one-time migration in `migrations/001_decouple_boards.sql` instead.
--
-- Player identity lives in its OWN file: the `players` table DDL is in
-- `app/lib/players.sql`, and `scores.player_id` below references `players(id)`.
-- BOTH this file and `players.sql` must be applied for a fresh install (apply
-- `players.sql` first, or alongside, since the FK below needs `players` to
-- exist). For an EXISTING database, run `migrations/002_player_identity.sql`.

-- `players` is defined canonically in `app/lib/players.sql`; this self-guarding
-- copy (mirrored EXACTLY, already IF NOT EXISTS so the duplication is harmless)
-- lets schema.sql apply standalone since `scores.player_id` below FK-references
-- `players(id)`. Keep `players.sql` as the source of truth for the players DDL.
CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  image       TEXT,
  handle      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS boards (
  id           TEXT PRIMARY KEY CONSTRAINT boards_id_format CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
  game_slug    TEXT,
  title        TEXT NOT NULL,
  sort         TEXT NOT NULL DEFAULT 'desc' CHECK (sort IN ('desc','asc')),
  score_label  TEXT NOT NULL DEFAULT 'Score',
  max_score    BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  handle      TEXT NOT NULL,
  score       BIGINT NOT NULL,
  ip_hash     TEXT,
  player_id   TEXT REFERENCES players(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scores_board_desc ON scores (board_id, score DESC, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_scores_board_asc  ON scores (board_id, score ASC, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_scores_board_created ON scores (board_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scores_player ON scores (player_id);
