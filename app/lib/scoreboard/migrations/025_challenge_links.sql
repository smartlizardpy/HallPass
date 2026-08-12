-- HallPass — migration: challenge links.
--
-- See `app/lib/challenges/schema.sql` for the fresh-install DDL and
-- `challenge-sharing-design.md` for the argument; keep all three in lockstep.
--
-- WHAT. A shareable "who can beat my score" URL. The owner mints one from their
-- standings, pastes it into a group chat, and anybody who opens it plays
-- immediately — signed out, no account — and is asked to sign in only once they
-- have a score worth keeping.
--
-- WHY THIS EXTENDS 022 RATHER THAN ADDING A TABLE. 022 built `kind` as a seam
-- for exactly this, and it holds. Two new kinds:
--
--     kind        | challenger | target        | window | what it is
--     ------------+------------+---------------+--------+------------------------
--     friend      | set        | set           | none   | unchanged
--     seasonal    | NULL       | NULL (anyone) | set    | still unbuilt
--     link        | set        | NULL (anyone) | none   | the shareable invitation
--     link_claim  | set        | set           | none   | one person who took it up
--
-- A `link` ROW IS AN INVITATION, NOT A CHALLENGE. It is never resolved, never
-- dismissed, and never appears in an inbox. It carries the code, the owner, the
-- board, and the owner's best score as of the last time they shared it.
--
-- A `link_claim` ROW IS A REAL CHALLENGE, created when a specific signed-in
-- person takes the link up. That shape is the whole point: because it has a
-- target, `resolveForScore` matches it with NO new branch (it filters on
-- `target_id = <player>` and carries no `kind` predicate), the inbox index
-- covers it, and the notification producers fire for it unchanged. 022's
-- `resolveForScore` docblock notes that `seasonal` would need a new arm because
-- it has no target; `link_claim` fits precisely because it puts the target back.
--
-- WHY THE `kind` WHITELIST IS DROPPED AND RE-ADDED, and it is the only
-- destructive statement here. 022 deliberately wrote each PER-KIND shape check
-- as `kind <> 'x' OR (...)` so that a new kind is a NEW constraint rather than
-- an edit to an existing one — and that held: the two below are additions and
-- nothing already in the table is touched by them. The whitelist is the one
-- constraint a new kind cannot avoid rewriting. Drop-then-add also makes every
-- constraint statement in this file idempotent, since Postgres has no
-- `ADD CONSTRAINT IF NOT EXISTS`.
--
-- WHY `revoked_at` IS A TIMESTAMP AND NOT A DELETE. Same reasoning as every
-- other ending in this table: the row is its own history. It also matters here
-- for a reason the others do not have — a revoked code must stay CLAIMED, so it
-- can never be reissued to a different player and quietly resurrect a URL
-- somebody already pasted into a public chat.
--
-- WHAT `opens` COUNTS: presses of "Beat it", not page views. Counting renders
-- would inflate on prefetch and on every refresh, and would answer a less
-- interesting question than "how many people actually started". It is the
-- owner's payoff for having posted the link, which is why it is a column here
-- rather than something only the analytics pipeline knows.
--
-- NO WINDOW ON EITHER NEW KIND. There is no cron in this repo
-- (`007_social_graph.sql` says so outright), so nothing may need a sweeper.
-- Revocation is the control a link has instead of an expiry.
--
-- Fully idempotent — every statement guarded, whole file in one transaction —
-- following `021_tracker.sql` and `022_challenges.sql`.

BEGIN;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE challenges
  -- `link` only. Opaque, from the confusable-free friend-code alphabet, so a
  -- code read aloud or retyped from a photo lands on one unambiguous target and
  -- cannot accidentally spell anything.
  ADD COLUMN IF NOT EXISTS code       TEXT,
  -- `link_claim` only → the `link` row it came from.
  ADD COLUMN IF NOT EXISTS parent_id  BIGINT,
  -- `link` only.
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  -- `link` only. See the header for what it counts.
  ADD COLUMN IF NOT EXISTS opens      INTEGER NOT NULL DEFAULT 0;

-- Self-referencing, and CASCADE like both player columns: deleting a link takes
-- its claims with it, because a claim with no invitation behind it can render
-- neither its origin nor its outbox group.
ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_parent_fk;
ALTER TABLE challenges
  ADD CONSTRAINT challenges_parent_fk
  FOREIGN KEY (parent_id) REFERENCES challenges(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Per-kind shape
-- ---------------------------------------------------------------------------

-- The one rewrite. Everything else in this file is additive.
ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_kind_chk;
ALTER TABLE challenges
  ADD CONSTRAINT challenges_kind_chk
  CHECK (kind IN ('friend', 'seasonal', 'link', 'link_claim'));

-- An invitation: an owner, no target, no window, and a code. `parent_id` must
-- be NULL — a link is nobody's child, and allowing one would admit a cycle.
ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_link_shape_chk;
ALTER TABLE challenges
  ADD CONSTRAINT challenges_link_shape_chk
  CHECK (
    kind <> 'link' OR (
      challenger_id IS NOT NULL
      AND target_id IS NULL
      AND code IS NOT NULL
      AND parent_id IS NULL
      AND starts_at IS NULL AND ends_at IS NULL
    )
  );

-- A claim: both parties, a parent, no code of its own, no window. `revoked_at`
-- is meaningless here — a claim ends by being resolved or dismissed, like every
-- other targeted challenge.
ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_link_claim_shape_chk;
ALTER TABLE challenges
  ADD CONSTRAINT challenges_link_claim_shape_chk
  CHECK (
    kind <> 'link_claim' OR (
      challenger_id IS NOT NULL
      AND target_id IS NOT NULL
      AND parent_id IS NOT NULL
      AND code IS NULL
      AND revoked_at IS NULL
      AND starts_at IS NULL AND ends_at IS NULL
    )
  );

-- `code` and `revoked_at` belong to links alone. Stated once, positively, so
-- neither `friend` nor `seasonal` can quietly grow a code — the two shape
-- checks above are written per-kind and say nothing about the kinds they do not
-- name.
ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_link_only_cols_chk;
ALTER TABLE challenges
  ADD CONSTRAINT challenges_link_only_cols_chk
  CHECK (
    kind = 'link' OR (code IS NULL AND revoked_at IS NULL)
  );

-- `parent_id` belongs to claims alone, for the same reason.
ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_parent_only_claims_chk;
ALTER TABLE challenges
  ADD CONSTRAINT challenges_parent_only_claims_chk
  CHECK (
    kind = 'link_claim' OR parent_id IS NULL
  );

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The lookup every `/c/<code>` visit performs. Unique because a code IS the
-- identity of a link, and partial so the NULL `code` every other kind carries
-- is not covered by a uniqueness rule that could never fire for it.
CREATE UNIQUE INDEX IF NOT EXISTS challenges_link_code_idx
  ON challenges (code) WHERE kind = 'link';

-- ONE LINK PER (owner, board) — the upsert target, so "share a link" twice on
-- the same board refreshes the score under a URL the owner may already have
-- posted, rather than minting a second URL that competes with the first.
-- `ON CONFLICT (challenger_id, board_id) WHERE kind = 'link'` infers exactly
-- this index; the predicate here and there must stay identical.
CREATE UNIQUE INDEX IF NOT EXISTS challenges_link_owner_idx
  ON challenges (challenger_id, board_id) WHERE kind = 'link';

-- Taking the same link up twice is the same claim, not a second one. This is
-- what makes the claim write an idempotent upsert, and it is needed separately
-- from `challenges_friend_pair_idx` because that one is partial on
-- `kind = 'friend'` and so does not cover these rows at all.
CREATE UNIQUE INDEX IF NOT EXISTS challenges_link_claim_idx
  ON challenges (parent_id, target_id) WHERE kind = 'link_claim';

-- The owner's grouped outbox: "14 opened, 3 beat you" reads the claims of one
-- link. `challenges_outbox_idx` leads on `challenger_id`, which answers a
-- different question and would scan every claim the owner ever received.
CREATE INDEX IF NOT EXISTS challenges_link_children_idx
  ON challenges (parent_id, id DESC) WHERE kind = 'link_claim';

COMMIT;
