-- HallPass — migration: the player's chosen meme avatar and its background colour.
--
-- See `app/lib/players.sql` for the canonical fresh-install DDL; keep the two in
-- lockstep.
--
-- WHY. Until now a player's avatar was a pure function of `public_id`
-- (`app/lib/avatars.ts`); there was nothing to choose. The settings page now
-- lets a player pick ONE meme from the catalogue and ONE of eight background
-- colours - nothing else. These two columns record that choice.
--
-- Both nullable, no default, no backfill: NULL means "never chose", and the
-- avatar is then derived from `public_id` exactly as before, so every existing
-- player keeps a working avatar the moment this lands.
--
-- The ids and colours are NOT enumerated in a CHECK on purpose: the catalogue
-- lives in `avatars.ts` (the single source of truth), and a stale value is
-- harmless because the reader ignores anything it does not recognise. The
-- checks below only bound the SHAPE so the columns cannot hold arbitrary text.
--
-- Run this BEFORE deploying the code that reads it - the player and friend
-- queries select the columns.
--
-- Fully idempotent - every statement guarded, whole file in one transaction.

BEGIN;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS avatar_meme   TEXT,
  ADD COLUMN IF NOT EXISTS avatar_colour TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'players_avatar_meme_chk') THEN
    ALTER TABLE players ADD CONSTRAINT players_avatar_meme_chk
      CHECK (avatar_meme IS NULL OR avatar_meme ~ '^[a-z0-9-]{1,40}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'players_avatar_colour_chk') THEN
    ALTER TABLE players ADD CONSTRAINT players_avatar_colour_chk
      CHECK (avatar_colour IS NULL OR avatar_colour ~ '^#[0-9a-f]{6}$');
  END IF;
END $$;

COMMIT;
