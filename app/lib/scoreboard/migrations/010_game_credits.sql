-- HallPass — migration: who added each game.
--
-- See `app/lib/game-credits.sql` for the canonical fresh-install DDL; keep the
-- two in lockstep.
--
-- The site footer says "Games by Ateş Demir · Site by Ozan Kaygusuz", which is
-- true in aggregate and useless per game. This records who actually put a
-- particular game on the site, so a store page can say "Added by Ateş".
--
-- Fully idempotent — every statement guarded, whole file in one transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS game_credits (
  -- PRIMARY KEY ON slug IS THE ENTIRE FEATURE. Paired with `ON CONFLICT DO
  -- NOTHING` at the write site, it means the FIRST upload wins and every later
  -- re-upload, bundle replacement or HTML paste is a silent no-op. "Who
  -- uploaded it first" is then a property the database enforces rather than
  -- something the application has to remember to check — and re-uploading a
  -- game to fix a bug is the common case, so getting this wrong would quietly
  -- re-attribute someone else's game to whoever last touched it.
  slug              TEXT PRIMARY KEY
                      CONSTRAINT game_credits_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),

  -- NO FOREIGN KEY to dashboard_users(email), deliberately — the same reasoning
  -- as `review_moderation_log.actor_email`. Removing somebody from the admin
  -- allow-list must not erase the record of what they contributed. Kept for
  -- tracing only; it is NEVER rendered publicly.
  uploader_email    TEXT NOT NULL,

  -- A SNAPSHOT, not a join. Joining `dashboard_users.name` at read time would
  -- mean a public credit line silently changing when someone edits their Google
  -- profile, and silently VANISHING when they are removed from the allow-list.
  -- A credit is a historical fact about who did something on a particular day,
  -- so it is stored as it read on that day.
  uploader_name     TEXT NOT NULL
                      CONSTRAINT game_credits_name_length CHECK (char_length(uploader_name) BETWEEN 1 AND 60),

  first_uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Only moves when an admin CORRECTS the credit by hand. The 27 games that
  -- predate this table have no row and no way to derive one, so the dashboard
  -- has to be able to set it; that path overwrites, while the automatic path
  -- never does.
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
