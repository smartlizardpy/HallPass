-- HallPass — permanent per-game play totals.
--
-- Canonical DDL; `scoreboard/migrations/052_game_play_totals.sql` mirrors it.
-- Keep the two in lockstep.
--
-- WHY THIS EXISTS. The public play count used to be a rolling 30-day PostHog
-- query, so a game that was not played lately lost its plays while its scores
-- (kept in Neon, with no expiry) stayed. This is the count that does not roll.
--
-- ONE ROW PER GAME, upserted — the table is flat at the size of the catalogue,
-- never an append-only log. It holds no visitor, device or IP data: a number and
-- a slug.
--
-- The total a reader sees is `baseline + plays`:
--   * `plays`          beacons recorded by `POST /api/v1/plays` since it shipped.
--   * `baseline`       history seeded ONCE from PostHog for events strictly before
--                      `baseline_until` (`scripts/backfill-play-totals.mjs`). The
--                      cutoff is what stops the backfill double-counting plays the
--                      beacon has recorded since, and lets it be re-run safely.
--
-- `slug` is not a foreign key, as everywhere else: games are a static array plus
-- `external_games`, not a table.

CREATE TABLE IF NOT EXISTS game_play_totals (
  slug           TEXT PRIMARY KEY,
  plays          BIGINT NOT NULL DEFAULT 0 CONSTRAINT game_play_totals_plays_chk CHECK (plays >= 0),
  baseline       BIGINT NOT NULL DEFAULT 0 CONSTRAINT game_play_totals_baseline_chk CHECK (baseline >= 0),
  baseline_until TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
