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

  -- `link` only: the opaque share code, and the owner's kill switch. Revoking
  -- keeps the row so the code stays claimed and can never be reissued to
  -- somebody else, resurrecting a URL already pasted into a public chat.
  code           TEXT,
  revoked_at     TIMESTAMPTZ,
  -- `link` only: presses of "Beat it", NOT page views — renders would inflate
  -- on prefetch and refresh, and answer a less interesting question.
  opens          INTEGER NOT NULL DEFAULT 0,
  -- `link_claim` only → the `link` it came from. The foreign key is NAMED below
  -- rather than written inline: 025 has to `DROP CONSTRAINT IF EXISTS` it by
  -- name to stay idempotent, and an inline reference here would be auto-named
  -- `challenges_parent_id_fkey`, so a fresh-install database and a migrated one
  -- would disagree about what the constraint is called. The other foreign keys
  -- are inline in both files and so agree already.
  parent_id      BIGINT,

  CONSTRAINT challenges_kind_chk CHECK (
    kind IN ('friend','seasonal','link','link_claim')
  ),
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
  -- An invitation: an owner, no target, a code, and nobody's child.
  CONSTRAINT challenges_link_shape_chk CHECK (
    kind <> 'link' OR (
      challenger_id IS NOT NULL AND target_id IS NULL
      AND code IS NOT NULL AND parent_id IS NULL
      AND starts_at IS NULL AND ends_at IS NULL
    )
  ),
  -- A claim: both parties and a parent. Target-shaped ON PURPOSE — that is what
  -- lets `resolveForScore` close it with no new branch.
  CONSTRAINT challenges_link_claim_shape_chk CHECK (
    kind <> 'link_claim' OR (
      challenger_id IS NOT NULL AND target_id IS NOT NULL
      AND parent_id IS NOT NULL
      AND code IS NULL AND revoked_at IS NULL
      AND starts_at IS NULL AND ends_at IS NULL
    )
  ),
  -- The per-kind checks say nothing about kinds they do not name, so the
  -- link-only and claim-only columns are fenced off positively as well.
  CONSTRAINT challenges_link_only_cols_chk CHECK (
    kind = 'link' OR (code IS NULL AND revoked_at IS NULL)
  ),
  CONSTRAINT challenges_parent_only_claims_chk CHECK (
    kind = 'link_claim' OR parent_id IS NULL
  ),
  CONSTRAINT challenges_parent_fk
    FOREIGN KEY (parent_id) REFERENCES challenges(id) ON DELETE CASCADE,
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

-- The `/c/<code>` lookup.
CREATE UNIQUE INDEX IF NOT EXISTS challenges_link_code_idx
  ON challenges (code) WHERE kind = 'link';

-- ONE LINK PER (owner, board) — the upsert target, so sharing twice refreshes
-- the score under a URL already posted rather than minting a rival one.
-- `ON CONFLICT (challenger_id, board_id) WHERE kind = 'link'` infers this.
CREATE UNIQUE INDEX IF NOT EXISTS challenges_link_owner_idx
  ON challenges (challenger_id, board_id) WHERE kind = 'link';

-- Taking the same link up twice is the same claim. Needed separately from
-- `challenges_friend_pair_idx`, which is partial on `kind = 'friend'`.
CREATE UNIQUE INDEX IF NOT EXISTS challenges_link_claim_idx
  ON challenges (parent_id, target_id) WHERE kind = 'link_claim';

-- The grouped outbox: the claims of ONE link.
CREATE INDEX IF NOT EXISTS challenges_link_children_idx
  ON challenges (parent_id, id DESC) WHERE kind = 'link_claim';
