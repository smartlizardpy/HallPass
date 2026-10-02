-- HallPass — the server-side daily streak (fresh install).
--
-- The canonical DDL for a database being created from scratch. For an EXISTING
-- database, run `scoreboard/migrations/036_player_streaks.sql` instead — the two
-- must stay in lockstep. Read that migration's header for the design argument.
-- In brief: one row per player, `last_day` is the player's own calendar day as a
-- DATE, `tz_offset_min` only locates their 17:00, and `last_nudged_day` makes the
-- reminder at most once per local day.

CREATE TABLE IF NOT EXISTS player_streaks (
  player_id       TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  current_streak  INTEGER NOT NULL DEFAULT 1 CHECK (current_streak >= 0),
  longest_streak  INTEGER NOT NULL DEFAULT 1 CHECK (longest_streak >= 0),
  last_day        DATE NOT NULL,
  tz_offset_min   SMALLINT NOT NULL DEFAULT 0 CHECK (tz_offset_min BETWEEN -840 AND 840),
  last_nudged_day DATE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The reminder scans players whose run is still worth saving.
CREATE INDEX IF NOT EXISTS player_streaks_due_idx
  ON player_streaks (last_day)
  WHERE current_streak >= 2;
