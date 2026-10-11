-- HallPass — game overrides schema for a FRESH database.
--
-- The game CATALOGUE lives in a static TS array (`app/lib/games.ts`): each game
-- is hand-authored there. This table is a thin, OPTIONAL override layer over the
-- descriptive fields of that array, letting the dashboard edit a game's copy
-- (title/tagline/description/category/tags) and its flags (is_new/is_featured)
-- without a code change. It is NOT a copy of the catalogue — a game has a row
-- here only once someone overrides it.
--
-- Per-column override semantics: a NULL column means "use the static games.ts
-- default" for that field; a non-NULL column REPLACES the default. So a row may
-- override just the tagline and leave everything else inherited.
--
-- `slug` is the join key back to the static game. It is intentionally NOT a
-- foreign key — games live in the static TS array, not a table — mirroring
-- `boards.game_slug` (see `scoreboard/schema.sql`). The slug is validated in app
-- code at write time; the CHECK here is the same lowercase-slug format guard.
--
-- For an EXISTING database, run the one-time
-- `scoreboard/migrations/003_game_overrides.sql` instead, plus
-- `014_game_platform.sql` for the `platform` column and `035_game_staging.sql`
-- for `staged` and `cover_url`, and `046_game_quality.sql` for the `quality_*` ratings.

CREATE TABLE IF NOT EXISTS game_overrides (
  slug         TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  title        TEXT,
  tagline      TEXT,
  description  TEXT,
  category     TEXT,
  tags         TEXT[],
  is_new       BOOLEAN,
  is_featured  BOOLEAN,

  -- Which devices the game is playable on. NULL carries the usual "inherit the
  -- static value" meaning, and the static value is itself optional — an untagged
  -- game resolves to UNKNOWN, which every read path renders exactly as it did
  -- before this column existed. See `014_game_platform.sql` for why this is a
  -- CHECK rather than an enum type.
  platform     TEXT
                 CONSTRAINT game_overrides_platform_valid
                 CHECK (platform IS NULL OR platform IN ('desktop', 'mobile', 'both')),

  -- Staged = visible only to beta testers and dashboard roles until published.
  -- Tri-state like every other column: NULL inherits the static `staged?` flag in
  -- `games.ts`, a non-NULL value wins (publishing writes `false`). See
  -- `035_game_staging.sql`.
  staged       BOOLEAN,

  -- The catalogue cover, typically a promoted tester shot served from
  -- `/game-media/...`. NULL inherits the static `coverUrl`, then the conventional
  -- `/games/<slug>/cover.png`.
  cover_url    TEXT,

  -- A super admin's 1-10 quality rating on five criteria; NULL = not rated on
  -- that criterion. The average of the rated ones nudges recommendations. See
  -- `046_game_quality.sql`.
  quality_gameplay SMALLINT CONSTRAINT game_overrides_quality_gameplay_range CHECK (quality_gameplay IS NULL OR quality_gameplay BETWEEN 1 AND 10),
  quality_visuals  SMALLINT CONSTRAINT game_overrides_quality_visuals_range  CHECK (quality_visuals  IS NULL OR quality_visuals  BETWEEN 1 AND 10),
  quality_sound    SMALLINT CONSTRAINT game_overrides_quality_sound_range    CHECK (quality_sound    IS NULL OR quality_sound    BETWEEN 1 AND 10),
  quality_polish   SMALLINT CONSTRAINT game_overrides_quality_polish_range   CHECK (quality_polish   IS NULL OR quality_polish   BETWEEN 1 AND 10),
  quality_fun      SMALLINT CONSTRAINT game_overrides_quality_fun_range      CHECK (quality_fun      IS NULL OR quality_fun      BETWEEN 1 AND 10),

  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
