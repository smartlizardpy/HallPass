-- HallPass — Web Push subscriptions (fresh install).
--
-- The canonical DDL for a database being created from scratch. For an EXISTING
-- database, run `scoreboard/migrations/023_push_subscriptions.sql` instead — the
-- two must stay in lockstep.
--
-- Read that migration's header for the design argument. In brief:
--
--   * ONE ROW PER DEVICE, not per player. A browser mints a separate
--     subscription per profile, so a phone and a school Chromebook are two rows,
--     and pushing to the wrong one is silence rather than a near miss.
--   * `endpoint` IS THE PRIMARY KEY — it is unique by construction, so
--     re-subscribing an existing device is an idempotent upsert.
--   * NO EXPIRY COLUMN AND NO SWEEPER. There is no cron in this repo. Dead rows
--     are deleted INLINE when a push service answers 404/410 Gone, so hygiene
--     happens exactly when it becomes discoverable.
--   * NO user agent, NO device name, NO IP. A subscriptions table becomes a
--     device inventory if you let it.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint     TEXT PRIMARY KEY,
  player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Bumped on re-subscribe so the device cap evicts the least recently seen,
  -- not the oldest.
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_player_idx
  ON push_subscriptions (player_id, last_seen_at DESC);
