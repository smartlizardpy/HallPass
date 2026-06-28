-- HallPass — one-time migration: game overrides table.
--
-- Adds `game_overrides`, an OPTIONAL per-column override layer over the
-- descriptive fields of the static game catalogue (`app/lib/games.ts`). A NULL
-- column means "use the games.ts default"; a non-NULL column replaces it. `slug`
-- is the join key back to the static game and is intentionally NOT a foreign key
-- (games live in a static TS array), mirroring `boards.game_slug`. See
-- `app/lib/games.sql` for the canonical fresh-install DDL.
--
-- RUN ONCE, inside a single transaction (Neon DDL is transactional). This file
-- is intentionally NOT idempotent. Do not re-run it. Fresh databases should use
-- `app/lib/games.sql` instead.

BEGIN;

CREATE TABLE IF NOT EXISTS game_overrides (
  slug         TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  title        TEXT,
  tagline      TEXT,
  description  TEXT,
  category     TEXT,
  tags         TEXT[],
  is_new       BOOLEAN,
  is_featured  BOOLEAN,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
