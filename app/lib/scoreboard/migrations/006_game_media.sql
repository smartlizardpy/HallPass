-- HallPass — migration: game media (screenshots) for the store page.
--
-- Adds `game_media`, one row per image belonging to a game's `/game/<slug>` store
-- page. See `app/lib/game-media.sql` for the canonical fresh-install DDL and the
-- full reasoning; the two must be kept in lockstep.
--
-- The short version of the one decision worth repeating here, because it is the
-- one that breaks things if someone "simplifies" it later: the bytes live under
-- the Vercel Blob prefix `game-media/<slug>/`, NOT `games/<slug>/`. Three
-- dashboard actions (`writeGameHtml`, `uploadBundleAction`, `clearHtmlAction`)
-- delete blobs under `games/<slug>/` wholesale, `scripts/sync-games.mjs` mirrors
-- that prefix into the repo, and `scripts/build-sw-manifest.mjs` precaches
-- everything it mirrors. Putting screenshots there would get them deleted by an
-- unrelated source upload, committed into git, and force-downloaded onto every
-- visitor's device.
--
-- Unlike 001/002/003/005, this migration IS fully idempotent — every statement is
-- `IF NOT EXISTS` and the whole file runs in one transaction — so it is safe to
-- re-apply. That follows `004_player_favorites.sql` rather than the "RUN ONCE, do
-- not re-run" files: with a runner that records what it applied
-- (`scripts/migrate.mjs`) but no guarantee it was used on a given database,
-- re-running must be a no-op rather than an error.

BEGIN;

CREATE TABLE IF NOT EXISTS game_media (
  id           TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
  slug         TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  kind         TEXT NOT NULL DEFAULT 'screenshot' CHECK (kind IN ('screenshot','hero')),
  blob_path    TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  width        INTEGER NOT NULL DEFAULT 0,
  height       INTEGER NOT NULL DEFAULT 0,
  bytes        INTEGER NOT NULL DEFAULT 0,
  alt          TEXT NOT NULL DEFAULT '',
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS game_media_slug_position_idx
  ON game_media (slug, position ASC, created_at ASC);

COMMIT;
