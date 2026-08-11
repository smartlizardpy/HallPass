-- HallPass — the notification tables (fresh install).
--
-- The canonical DDL for a database being created from scratch. For an EXISTING
-- database, run `scoreboard/migrations/024_notifications.sql` instead — the two
-- must stay in lockstep.
--
-- Read that migration's header for the design argument, and
-- `notifications-design.md` for the whole thing. In brief:
--
--   * `player_id` IS NULLABLE and is the discriminator: set = personal, NULL =
--     site-wide broadcast. Fanning a game drop out to one row per player would
--     be O(players) writes that, with no cron, nothing could ever prune.
--   * NO `read_at` COLUMN. A shared broadcast row cannot carry per-player state,
--     so the read model works by timestamp for broadcasts no matter what; giving
--     personal rows a second mechanism would buy inconsistency, not capability.
--     Unread = created after your mark in `notification_state`.
--   * `dedupe_key` IS PARTIALLY UNIQUE, so a producer can give an event an
--     identity ("this game has already been announced") and a keyless producer
--     is simply never deduped.
--   * `notification_prefs` IS SPARSE — a row only where a player has DEVIATED
--     from the default in `config.ts`. A new kind is therefore live for everyone
--     the moment it deploys, with no backfill.
--   * KINDS ARE NOT CHECK-CONSTRAINED; CHANNELS ARE. Every kind produces an
--     identically shaped row and the catalogue grows with each new producer, so
--     a CHECK would be a migration per kind for no integrity gained. The three
--     channels, by contrast, ARE the model and are read by the delivery path.
--   * RETENTION IS INLINE. Both inserts cap themselves in the same statement
--     that writes them, exactly as `push_subscriptions` caps devices.

CREATE TABLE IF NOT EXISTS notifications (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id    TEXT REFERENCES players(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  url          TEXT NOT NULL,
  dedupe_key   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_player_idx
  ON notifications (player_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_broadcast_idx
  ON notifications (created_at DESC)
  WHERE player_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_state (
  player_id  TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_prefs (
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  channel    TEXT NOT NULL CHECK (channel IN ('off', 'bell', 'push')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, kind)
);
