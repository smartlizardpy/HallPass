-- HallPass — external (off-site) games schema for a FRESH database.
--
-- The primary game CATALOGUE lives in a static TS array (`app/lib/games.ts`) and
-- its optional per-column override layer lives in `game_overrides`
-- (`app/lib/games.sql`). THIS table is different in kind: each row is a WHOLE game
-- that is NOT in the static array — a game hosted OFF-SITE whose play surface is a
-- third-party URL (`external_url`, embedded in an iframe). External games are
-- appended to the resolved catalogue after the static entries, so they surface in
-- the same home/category/tag listings as native games.
--
-- Unlike `game_overrides`, every descriptive column here is NOT NULL with a
-- sensible default: an external game is defined entirely by its row (there is no
-- static entry to inherit from). `cover_url` is the lone NULLABLE column — a NULL
-- means "no bespoke cover art" and the app falls back to its generated placeholder.
-- `platform` is the second exception, for the reason given at the column.
--
-- `slug` is the primary key and the join key used across the app. It is
-- intentionally NOT a foreign key — games are not otherwise a table — mirroring
-- `boards.game_slug` (see `scoreboard/schema.sql`) and `game_overrides.slug`. The
-- slug is validated in app code at write time; the CHECK here is the same
-- lowercase-slug format guard used by `game_overrides`.
--
-- For an EXISTING database, run the one-time
-- `scoreboard/migrations/005_external_games.sql` instead, plus
-- `014_game_platform.sql` for the `platform` column.

CREATE TABLE IF NOT EXISTS external_games (
  slug          TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  title         TEXT NOT NULL,
  tagline       TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'Arcade',
  tags          TEXT[] NOT NULL DEFAULT '{}',
  external_url  TEXT NOT NULL,
  cover_url     TEXT,
  accent        TEXT NOT NULL DEFAULT '#7c5cff',
  gradient_from TEXT NOT NULL DEFAULT '#7c5cff',
  gradient_to   TEXT NOT NULL DEFAULT '#00e5ff',
  is_new        BOOLEAN NOT NULL DEFAULT true,
  is_featured   BOOLEAN NOT NULL DEFAULT false,

  -- Which devices the game is playable on — NULLABLE, breaking this table's
  -- NOT-NULL-with-a-default convention on purpose. NULL means UNKNOWN: nobody has
  -- opened the game on a phone and checked. `NOT NULL DEFAULT 'both'` would make
  -- every row claim mobile support it was never tested for, which is the exact
  -- false assertion the column exists to prevent.
  platform      TEXT
                  CONSTRAINT external_games_platform_valid
                  CHECK (platform IS NULL OR platform IN ('desktop', 'mobile', 'both')),

  plays         INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
