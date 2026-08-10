-- HallPass — the challenges table (fresh install).
--
-- The canonical DDL for a database being created from scratch. For an EXISTING
-- database, run `scoreboard/migrations/022_challenges.sql` instead — the two
-- must stay in lockstep.
--
-- Read that migration's header for the design argument, and `challenge-design.md`
-- for the whole thing. In brief:
--
--   * ONE table with a `kind` discriminator, modelling A GOAL ON A BOARD rather
--     than "A challenges B". Participants and time are separate NULLABLE
--     dimensions, so a site-wide/monthly challenge is a new `kind` plus a new
--     CHECK rather than a rewrite. `seasonal` is expressible and constrained;
--     NOTHING BUILDS IT.
--   * NO `status` COLUMN. The lifecycle is four timestamps on one row, and
--     "open" is `resolved_at IS NULL AND dismissed_at IS NULL`. An enum would be
--     a second source of truth for facts the timestamps already carry.
--   * ONE ROW PER (challenger, target, board), UPSERTED AND NEVER DELETED, so
--     the row doubles as its own cooldown record and the table stays bounded.
--     `friendships` needed a separate `friend_request_attempts` table for that
--     job only because a decline deletes the friendship row.
--   * `target_score` IS A SNAPSHOT, so a moderator deleting the challenger's
--     score cannot break or silently rewrite a challenge already sent.
--   * BOARD `sort` IS NOT DENORMALISED — `asc` boards are time/golf where lower
--     wins, and resolution joins `boards` for it.
--   * `accepted_at` IS A SIGNAL, NOT A GATE. Resolution never reads it.

CREATE TABLE IF NOT EXISTS challenges (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind           TEXT NOT NULL DEFAULT 'friend',
  board_id       TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  challenger_id  TEXT REFERENCES players(id) ON DELETE CASCADE,
  -- NULL means EVERYONE (seasonal), not "unknown".
  target_id      TEXT REFERENCES players(id) ON DELETE CASCADE,
  target_score   BIGINT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at    TIMESTAMPTZ,
  resolved_at    TIMESTAMPTZ,
  resolved_score BIGINT,
  dismissed_at   TIMESTAMPTZ,
  -- Seasonal only, evaluated AT READ TIME — there is no cron in this repo.
  starts_at      TIMESTAMPTZ,
  ends_at        TIMESTAMPTZ,

  CONSTRAINT challenges_kind_chk CHECK (kind IN ('friend','seasonal')),
  CONSTRAINT challenges_friend_shape_chk CHECK (
    kind <> 'friend' OR (
      challenger_id IS NOT NULL AND target_id IS NOT NULL
      AND starts_at IS NULL AND ends_at IS NULL
    )
  ),
  CONSTRAINT challenges_seasonal_shape_chk CHECK (
    kind <> 'seasonal' OR (
      challenger_id IS NULL AND target_id IS NULL
      AND starts_at IS NOT NULL AND ends_at IS NOT NULL
    )
  ),
  CONSTRAINT challenges_no_self_chk CHECK (
    challenger_id IS NULL OR target_id IS NULL OR challenger_id <> target_id
  ),
  CONSTRAINT challenges_resolved_shape_chk CHECK (
    (resolved_at IS NULL) = (resolved_score IS NULL)
  ),
  CONSTRAINT challenges_ending_chk CHECK (
    resolved_at IS NULL OR dismissed_at IS NULL
  ),
  CONSTRAINT challenges_window_chk CHECK (
    starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at
  )
);

-- THE UPSERT TARGET — `ON CONFLICT (challenger_id, target_id, board_id) WHERE
-- kind = 'friend'` infers exactly this index, so both predicates must match.
CREATE UNIQUE INDEX IF NOT EXISTS challenges_friend_pair_idx
  ON challenges (challenger_id, target_id, board_id) WHERE kind = 'friend';

CREATE INDEX IF NOT EXISTS challenges_inbox_idx
  ON challenges (target_id, id DESC)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS challenges_outbox_idx
  ON challenges (challenger_id, id DESC);

CREATE INDEX IF NOT EXISTS challenges_resolve_idx
  ON challenges (board_id, target_id)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;
