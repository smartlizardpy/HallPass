-- HallPass — migration: friend challenges.
--
-- See `app/lib/challenges/schema.sql` for the canonical fresh-install DDL and
-- `challenge-design.md` for the full argument; keep all three in lockstep.
--
-- WHAT. A challenge is a score to beat on a board, aimed at a friend. The game
-- triggers it through the SDK, HallPass draws the picker, and the row resolves
-- itself the moment the target posts a qualifying score.
--
-- WHY ONE TABLE WITH A `kind` DISCRIMINATOR. The requirement is that a
-- site-wide/monthly challenge becomes cheap later without a rewrite. The way to
-- get that is to stop modelling "A challenges B" and model A GOAL ON A BOARD,
-- with participants and time as separate NULLABLE dimensions:
--
--     kind      | challenger  | target        | window
--     ----------+-------------+---------------+----------------------
--     friend    | set         | set           | none
--     seasonal  | NULL (site) | NULL (anyone) | starts_at / ends_at
--
-- Each kind gets its OWN CHECK constraint, so a malformed row of either kind is
-- impossible at the database level rather than by convention. `seasonal` is
-- expressible and constrained; NOTHING BUILDS IT. That distinction is the whole
-- point — the unused `gh_*` columns in 021 are the in-repo example of
-- scaffolding that reads as finished, and the seam here is three nullable
-- columns and a CHECK rather than a half-built feature.
--
-- HONEST LIMIT OF THAT SEAM: `resolved_at`/`resolved_score` describe THE TARGET
-- resolving the row, which is meaningful only for `friend`. A seasonal
-- challenge has many participants and will need its own participation table
-- when someone builds it. These columns are not pretending to cover that.
--
-- WHY THERE IS NO `status` COLUMN. The lifecycle is four timestamps on one row
-- (created / accepted / resolved / dismissed), and "open" is
-- `resolved_at IS NULL AND dismissed_at IS NULL`. A status enum would be a
-- second source of truth for facts the timestamps already carry, and 021's
-- `tracker_items_done_at_matches_status` exists precisely because keeping an
-- enum and a timestamp agreeing is a constraint somebody has to write.
--
-- WHY ONE ROW PER (challenger, target, board), UPSERTED AND NEVER DELETED. The
-- row doubles as its own cooldown record, so re-challenging the same friend on
-- the same board replaces rather than stacks, and the table is bounded at
-- players x friends x boards. `friendships` needed a SEPARATE
-- `friend_request_attempts` table for exactly this job only because a decline
-- DELETES the friendship row; nothing here is ever deleted, so one table does.
--
-- WHY `target_score` IS A SNAPSHOT and not a reference to `scores.id`. A
-- moderator deleting the challenger's score must not break, or silently rewrite,
-- a challenge somebody has already been sent.
--
-- WHY BOARD `sort` IS NOT DENORMALISED HERE. `asc` boards are time/golf, where
-- LOWER wins. The board owns that fact and resolution joins for it, so a board
-- whose direction is corrected does not leave challenges scoring backwards.
--
-- ON DELETE: both player columns CASCADE, matching `friendships`. A challenge is
-- not a safety record — unlike `player_blocks.blocked_id`, which deliberately
-- has no foreign key so a block outlives the blocked party's account churn.
--
-- Fully idempotent — every statement guarded, whole file in one transaction —
-- following `021_tracker.sql` rather than the "RUN ONCE" migrations.

BEGIN;

CREATE TABLE IF NOT EXISTS challenges (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Discriminator. Defaulted so every row written by the friend-challenge code
  -- path is correct without naming it, and whitelisted so a typo cannot invent
  -- a third kind that no CHECK below constrains.
  kind           TEXT NOT NULL DEFAULT 'friend',

  -- A challenge targets a BOARD, never a game. `boards.game_slug` is nullable
  -- and one game may carry several boards, so "beat my score on Duskfall" is
  -- ambiguous at the game level and exact at the board level. The UI says the
  -- game; the row means the board.
  board_id       TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,

  challenger_id  TEXT REFERENCES players(id) ON DELETE CASCADE,
  -- NULL means EVERYONE (seasonal), not "unknown". The per-kind CHECK below is
  -- what stops that reading from being ambiguous.
  target_id      TEXT REFERENCES players(id) ON DELETE CASCADE,

  target_score   BIGINT NOT NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Stamped when the target presses Play FROM THE INBOX. Resolution never reads
  -- it: accept is a signal to the challenger ("they're on it") and a defensible
  -- basis for win/loss records later, NOT a gate. Gating on it would mean
  -- beating the score after launching from the catalogue did not count, and as a
  -- required STATE it would break the seasonal kind, which nobody accepts.
  accepted_at    TIMESTAMPTZ,

  resolved_at    TIMESTAMPTZ,
  resolved_score BIGINT,

  -- The alternate ending. Dismissing does NOT report "declined" back to the
  -- challenger: `social/config.ts` deletes a declined friend request rather than
  -- storing the status because "children decline by accident constantly", and
  -- the same courtesy applies here. The row persists so the cooldown outlives
  -- the dismissal.
  dismissed_at   TIMESTAMPTZ,

  -- Seasonal only. Evaluated AT READ TIME, never by a sweeper — there is no cron
  -- in this repo (`007_social_graph.sql` says so outright), so any design that
  -- needed one would be dead on arrival.
  starts_at      TIMESTAMPTZ,
  ends_at        TIMESTAMPTZ,

  CONSTRAINT challenges_kind_chk CHECK (kind IN ('friend','seasonal')),

  -- Per-kind shape. Written as `kind <> 'x' OR (...)` so each constraint is
  -- inert for rows of the other kind and a future third kind is a new
  -- constraint rather than an edit to these two.
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

  -- Self-challenge is meaningless. Guarded at the database level for the same
  -- reason `friendships_ordered_chk`'s `<` excludes equality: then no
  -- application path has to remember to check it.
  CONSTRAINT challenges_no_self_chk CHECK (
    challenger_id IS NULL OR target_id IS NULL OR challenger_id <> target_id
  ),

  -- The score that won is part of what "resolved" MEANS; a resolved row with no
  -- score cannot render "beat your 4,200 with 5,100".
  CONSTRAINT challenges_resolved_shape_chk CHECK (
    (resolved_at IS NULL) = (resolved_score IS NULL)
  ),

  -- A row cannot be both won and thrown away. Both writes filter on the other
  -- being NULL, so this is the database agreeing with the store rather than
  -- trusting it.
  CONSTRAINT challenges_ending_chk CHECK (
    resolved_at IS NULL OR dismissed_at IS NULL
  ),

  CONSTRAINT challenges_window_chk CHECK (
    starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at
  )
);

-- THE UPSERT TARGET. `ON CONFLICT (challenger_id, target_id, board_id) WHERE
-- kind = 'friend'` infers exactly this index, which is why the predicate here
-- and there must stay identical. Partial so the seasonal kind — where both id
-- columns are NULL and Postgres would treat every NULL as distinct anyway — is
-- not covered by a constraint that could never fire for it.
CREATE UNIQUE INDEX IF NOT EXISTS challenges_friend_pair_idx
  ON challenges (challenger_id, target_id, board_id) WHERE kind = 'friend';

-- The inbox: open challenges aimed at me, newest first. Partial because every
-- inbox read filters resolved and dismissed rows out, and those only accumulate.
CREATE INDEX IF NOT EXISTS challenges_inbox_idx
  ON challenges (target_id, id DESC)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;

-- The outbox, and the "did they beat it yet" read. Not partial: the challenger
-- wants to see the resolved ones — that is the payoff.
CREATE INDEX IF NOT EXISTS challenges_outbox_idx
  ON challenges (challenger_id, id DESC);

-- Resolution: "which open challenges on this board is this player the target
-- of". Leads on board_id because that is the equality the score path knows.
CREATE INDEX IF NOT EXISTS challenges_resolve_idx
  ON challenges (board_id, target_id)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;

COMMIT;
