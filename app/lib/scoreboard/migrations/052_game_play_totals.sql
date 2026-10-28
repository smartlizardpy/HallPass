-- HallPass — migration: permanent per-game play totals.
--
-- See `app/lib/play-totals/schema.sql` for the canonical DDL and commentary; keep
-- the two in lockstep. Fully idempotent; whole file in one transaction. Touches
-- no existing table.

BEGIN;

CREATE TABLE IF NOT EXISTS game_play_totals (
  slug           TEXT PRIMARY KEY,
  plays          BIGINT NOT NULL DEFAULT 0 CONSTRAINT game_play_totals_plays_chk CHECK (plays >= 0),
  baseline       BIGINT NOT NULL DEFAULT 0 CONSTRAINT game_play_totals_baseline_chk CHECK (baseline >= 0),
  baseline_until TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
