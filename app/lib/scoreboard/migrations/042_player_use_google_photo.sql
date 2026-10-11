-- HallPass — migration: opt-in to showing the Google profile picture to friends.
--
-- See `app/lib/players.sql` for the canonical fresh-install DDL; keep the two in
-- lockstep.
--
-- WHY. `players.image` is the Google account photo, which for a school-age
-- player is often a real photograph of a child. Until now it was shown on game
-- leaderboards, on reviews and in the minimal profile shape. The default is now
-- a meme avatar (see `app/lib/avatars.ts`, picked from `public_id`), and the
-- real photo is shown ONLY to ACCEPTED FRIENDS, ONLY when the player ticks the
-- box in settings. This column records that choice.
--
-- NOT NULL DEFAULT false: every existing player is opted OUT, so deploying this
-- hides every real photo that was previously public until its owner opts in.
-- Public queries no longer select `image` at all; friend-scoped queries select
-- `CASE WHEN p.use_google_photo THEN p.image END`.
--
-- Fully idempotent - every statement guarded, whole file in one transaction.

BEGIN;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS use_google_photo BOOLEAN NOT NULL DEFAULT false;

COMMIT;
