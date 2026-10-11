-- HallPass — migration: a super admin's quality rating of each game.
--
-- See `app/lib/games.sql` for the canonical fresh-install DDL; keep the two in
-- lockstep.
--
-- WHY. Recommendations should favour better games. A super admin rates a game
-- 1-10 on five criteria (gameplay, visuals, sound, polish, fun); the average of
-- the criteria that have been rated is the game's quality, and `for-you.ts` and
-- the Featured order lean towards higher quality (a gentle tie-breaker, never a
-- filter). The ratings are editorial and say nothing about any player.
--
-- WHY FIVE NULLABLE COLUMNS. NULL carries the usual `game_overrides` meaning of
-- "nothing set" - here, "not rated on this criterion" - so a game may be rated
-- on one thing and not another, and an unrated game ranks as neutral rather than
-- as bad. A CHECK keeps a hand-run psql session inside 1-10.
--
-- Nullable, no default, no backfill: nothing is rated yet. Run this BEFORE
-- deploying the code that reads it - the override read selects these columns.
--
-- Fully idempotent - every statement guarded, whole file in one transaction.

BEGIN;

ALTER TABLE game_overrides
  ADD COLUMN IF NOT EXISTS quality_gameplay SMALLINT,
  ADD COLUMN IF NOT EXISTS quality_visuals  SMALLINT,
  ADD COLUMN IF NOT EXISTS quality_sound    SMALLINT,
  ADD COLUMN IF NOT EXISTS quality_polish   SMALLINT,
  ADD COLUMN IF NOT EXISTS quality_fun      SMALLINT;

DO $$
DECLARE
  col TEXT;
BEGIN
  FOREACH col IN ARRAY ARRAY['gameplay', 'visuals', 'sound', 'polish', 'fun'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'game_overrides_quality_' || col || '_range'
    ) THEN
      EXECUTE format(
        'ALTER TABLE game_overrides ADD CONSTRAINT %I CHECK (%I IS NULL OR %I BETWEEN 1 AND 10)',
        'game_overrides_quality_' || col || '_range', 'quality_' || col, 'quality_' || col
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
