-- HallPass — migration: separate the game's AUTHOR from the person who added it.
--
-- `010_game_credits.sql` recorded a single name, which conflated two genuinely
-- different contributions and would have quietly taken authorship off the person
-- who actually wrote the game:
--
--   * the AUTHOR made it;
--   * the UPLOADER brought it onto HallPass — generated the cover, wrote the
--     metadata, wired up the scoreboard and the achievements.
--
-- On this site those are usually two different people, and the footer already
-- draws the same line ("Games by Ateş Demir · Site by Ozan Kaygusuz").
--
-- `author_name` is NULLABLE and unconstrained beyond a length check, on purpose:
-- unlike the uploader it is NOT drawn from `dashboard_users`, because plenty of
-- games come from somebody with no account here. NULL means "we do not know",
-- which the store page renders as nothing rather than as a guess.
--
-- Additive and idempotent; safe to apply before the code that reads it.

BEGIN;

ALTER TABLE game_credits
  ADD COLUMN IF NOT EXISTS author_name TEXT;

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so the guard is explicit — the
-- same pattern `007_social_graph.sql` uses for its named CHECKs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_credits_author_length'
  ) THEN
    ALTER TABLE game_credits
      ADD CONSTRAINT game_credits_author_length
      CHECK (author_name IS NULL OR char_length(author_name) BETWEEN 1 AND 60);
  END IF;
END $$;

COMMIT;
