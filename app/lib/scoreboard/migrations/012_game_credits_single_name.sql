-- HallPass — migration: one credit per game, not two.
--
-- `011_game_credit_author.sql` split the credit into "who made it" and "who added
-- it", on the theory that one person writes a game and another does the HallPass
-- integration. The owner's answer: everybody here writes their own games. The two
-- names were always the same person, so the split bought nothing and cost a form
-- with two boxes that always want the same answer — which is a form people fill
-- in wrong.
--
-- `uploader_name` survives as THE credit and `author_name` is dropped. Keeping
-- the uploader column is the right way round: it is the one the automatic capture
-- on upload writes, so a game credited without anybody touching the dashboard
-- still gets a name.
--
-- Dropping a column is normally something to think hard about. It is safe here
-- because `author_name` was added earlier the same day, has never been applied to
-- production, and holds no data anywhere but a development branch.
--
-- Idempotent; safe to re-run.

BEGIN;

ALTER TABLE game_credits
  DROP CONSTRAINT IF EXISTS game_credits_author_length;

ALTER TABLE game_credits
  DROP COLUMN IF EXISTS author_name;

COMMENT ON COLUMN game_credits.uploader_name IS
  'Who made this game. Rendered publicly as "By <name>". Snapshotted at write time, never joined from dashboard_users.';

COMMIT;
