-- HallPass — who added each game. Canonical fresh-install DDL.
--
-- Kept in lockstep with `app/lib/scoreboard/migrations/010_game_credits.sql`,
-- which is the same body wrapped in BEGIN/COMMIT. Read that file for the full
-- reasoning; the two decisions that matter are repeated here because they are
-- the ones somebody will be tempted to "improve".

CREATE TABLE IF NOT EXISTS game_credits (
  -- PRIMARY KEY ON slug IS THE ENTIRE FEATURE. Paired with `ON CONFLICT DO
  -- NOTHING` at the write site it means the FIRST upload wins and every later
  -- re-upload is a silent no-op, so re-uploading a game to fix a bug — much the
  -- commonest write on this path — cannot re-attribute it to whoever last
  -- touched it.
  slug              TEXT PRIMARY KEY
                      CONSTRAINT game_credits_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),

  -- No foreign key to dashboard_users(email), like `review_moderation_log.actor_email`:
  -- removing somebody from the admin allow-list must not erase what they
  -- contributed. Stored for tracing, NEVER rendered.
  uploader_email    TEXT NOT NULL,

  -- A SNAPSHOT, not a join. Joining `dashboard_users.name` at read time would let
  -- a public credit line change when someone edits their Google profile and
  -- vanish when they leave the allow-list. A credit is a historical fact.
  uploader_name     TEXT NOT NULL
                      CONSTRAINT game_credits_name_length CHECK (char_length(uploader_name) BETWEEN 1 AND 60),

  first_uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
