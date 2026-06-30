-- HallPass — one-time migration: per-player favorites.
--
-- Adds `player_favorites`, the signed-in mirror of the browser's localStorage
-- favorites list (see `app/lib/personalization.ts`). Each row is one game a
-- verified player has favorited, keyed by the player's Google subject id; the
-- composite PRIMARY KEY (player_id, slug) makes a favorite idempotent (a repeat
-- add is a no-op via `ON CONFLICT DO NOTHING`).
--
-- FK behavior mirrors `scores.player_id → players(id)` from
-- `002_player_identity.sql`, but with the OPPOSITE on-delete rule on purpose: a
-- score has standalone meaning so it DE-TAGS (ON DELETE SET NULL) when its player
-- is removed, whereas a favorite is meaningless without its owner — so it
-- CASCADE-deletes with the player. Anonymous/guest favorites never live here;
-- they stay device-local in localStorage.
--
-- The `created_at DESC` index backs the newest-first read in `app/lib/favorites.ts`
-- (`listFavorites`). DDL is idempotent (every statement is IF NOT EXISTS), so this
-- file is safe to re-apply; it still runs inside a single transaction like the
-- earlier migrations (Neon DDL is transactional).

BEGIN;

CREATE TABLE IF NOT EXISTS player_favorites (
  player_id  TEXT        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slug       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, slug)
);

CREATE INDEX IF NOT EXISTS player_favorites_player_created_idx
  ON player_favorites (player_id, created_at DESC);

COMMIT;
