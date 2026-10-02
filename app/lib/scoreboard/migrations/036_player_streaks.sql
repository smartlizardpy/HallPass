-- HallPass — migration: the server-side daily streak.
--
-- See `app/lib/streak/schema.sql` for the canonical fresh-install DDL; keep the
-- two in lockstep. `docs/streaks-design.md` has the whole argument.
--
-- WHY THIS EXISTS. A streak used to live only in the browser's localStorage, so
-- the server could not notify anybody about it. This table is the minimum the
-- reminder needs: how long the run is, which day it last advanced on, and when
-- that player's evening is.
--
-- ONE ROW PER PLAYER, bounded by construction at the number of players, so there
-- is no retention to run — the same argument `push_subscriptions` makes.
--
-- `last_day` IS A DATE, NOT A TIMESTAMP. A streak day is the player's own
-- calendar day as their device reports it. Storing a UTC instant would mean
-- re-deriving that day from an offset that may since have changed.
--
-- `tz_offset_min` is the device's offset at its last beacon, in minutes EAST of
-- UTC. It exists only to find the player's 17:00. A DST change shifts that by an
-- hour until the next beacon, which is accepted.
--
-- `last_nudged_day` is the guard that makes the reminder at most once per local
-- day. The notification dedupe key says the same thing, but this column is what
-- the "who is due" query reads, so a nudged player is not even selected again.
--
-- READ THIS BEFORE DEPLOYING THE CODE. Every read and write is fail-soft, so a
-- deploy that ships before this migration runs does nothing rather than failing;
-- apply it to the database first.
--
-- Fully idempotent — whole file in one transaction.

BEGIN;

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

COMMIT;
