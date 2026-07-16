-- HallPass — one-time migration: external (off-site) games table.
--
-- Adds `external_games`, a table whose rows are WHOLE games hosted off-site (their
-- play surface is a third-party `external_url` embedded in an iframe), as opposed
-- to `game_overrides`, which only patches descriptive fields of the static
-- catalogue. External games are appended to the resolved catalogue after the
-- static `app/lib/games.ts` entries. Unlike `game_overrides`, every descriptive
-- column is NOT NULL with a default (there is no static entry to inherit from);
-- `cover_url` is the lone NULLABLE column. `slug` is the primary/join key and is
-- intentionally NOT a foreign key, mirroring `boards.game_slug` and
-- `game_overrides.slug`. See `app/lib/external-games.sql` for the canonical
-- fresh-install DDL.
--
-- RUN ONCE, inside a single transaction (Neon DDL is transactional). This file is
-- intentionally NOT idempotent. Do not re-run it. Fresh databases should use
-- `app/lib/external-games.sql` instead.

BEGIN;

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
  plays         INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
