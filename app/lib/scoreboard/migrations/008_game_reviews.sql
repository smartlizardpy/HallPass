-- HallPass — migration: game reviews.
--
-- See `app/lib/reviews.sql` for the canonical fresh-install DDL and the full
-- reasoning; keep the two in lockstep.
--
-- THE ONE DECISION EVERYTHING ELSE FOLLOWS FROM: `UNIQUE (slug, player_id)`.
-- This is a REVIEW model, not a comment thread — one review per player per game,
-- editable in place. That single constraint does a surprising amount of work:
--
--   * It bounds the moderation surface. A comment thread grows without limit and
--     the same person can post twenty times; reviews cap at one per player per
--     game, so a class of thirty produces at most thirty rows.
--   * It makes the recommend ratio HONEST. Without it, one motivated player could
--     post ten "Not recommended" entries and move the aggregate on their own.
--   * It makes "N people found this helpful" meaningful, because a review is a
--     stable thing to vote on rather than a message in a stream.
--   * It removes the reply/pile-on surface entirely. There is nothing to reply
--     to, which for a school-age audience is the single highest-value thing not
--     to build.
--
-- Fully idempotent — every statement guarded, whole file in one transaction —
-- following `004_player_favorites.sql` rather than the "RUN ONCE" migrations.

BEGIN;

CREATE TABLE IF NOT EXISTS game_reviews (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug              TEXT NOT NULL
                      CONSTRAINT game_reviews_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  -- CASCADE, deliberately unlike `scores.player_id` which is ON DELETE SET NULL.
  -- A score is a standalone FACT — "someone reached 9000" stays true and stays
  -- ranked, so de-tagging preserves competitive integrity. A review is
  -- ATTRIBUTED SPEECH: an orphaned one is strictly worse than none, because
  -- nobody can be held responsible for it, the author can no longer remove it,
  -- and a moderator can no longer trace it. Deleting the account should delete
  -- what the account said.
  player_id         TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  recommended       BOOLEAN NOT NULL,
  body              TEXT NOT NULL
                      CONSTRAINT game_reviews_body_length CHECK (char_length(body) BETWEEN 2 AND 500),
  -- sha256 of the canonicalised body. Backs double-submit suppression without a
  -- client-supplied idempotency key: no extra trusted input, and it incidentally
  -- stops copy-paste spam.
  body_hash         TEXT NOT NULL,
  -- 'visible' | 'hidden' (a moderator took it down, reversible) | 'deleted' (the
  -- author removed it — a tombstone, so a report still points at real text and a
  -- repeat offender cannot launder their history by self-deleting).
  status            TEXT NOT NULL DEFAULT 'visible'
                      CONSTRAINT game_reviews_status CHECK (status IN ('visible','hidden','deleted')),
  helpful_count     INTEGER NOT NULL DEFAULT 0,
  report_count      INTEGER NOT NULL DEFAULT 0,
  ip_hash           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_changed_at TIMESTAMPTZ
);

-- One review per player per game. See the header.
CREATE UNIQUE INDEX IF NOT EXISTS game_reviews_one_per_player_idx
  ON game_reviews (slug, player_id);

-- The public read. Ordered by `id` alone, NOT `(created_at DESC, id DESC)`:
-- `id` is GENERATED ALWAYS AS IDENTITY so it is already insertion-ordered, and
-- one comparison column makes the keyset cursor exactly correct (`id < $cursor`).
-- Partial, because every public read filters on status and 'visible' will be the
-- overwhelming majority.
CREATE INDEX IF NOT EXISTS game_reviews_public_idx
  ON game_reviews (slug, id DESC) WHERE status = 'visible';

-- "Most helpful" sort.
CREATE INDEX IF NOT EXISTS game_reviews_helpful_idx
  ON game_reviews (slug, helpful_count DESC, id DESC) WHERE status = 'visible';

-- Per-player rate limiting and "show me everything this player wrote" when
-- deciding whether to ban them.
CREATE INDEX IF NOT EXISTS game_reviews_player_idx ON game_reviews (player_id, id DESC);

-- Double-submit suppression.
CREATE INDEX IF NOT EXISTS game_reviews_dedup_idx ON game_reviews (player_id, body_hash);

-- Per-IP flood backstop. Loose by necessity — see the config note about schools
-- NATing an entire site to one egress address.
CREATE INDEX IF NOT EXISTS game_reviews_ip_idx ON game_reviews (ip_hash, created_at DESC);

-- ---------------------------------------------------------------------------
-- Helpful votes
-- ---------------------------------------------------------------------------
--
-- One row per (review, voter) makes a vote idempotent via the PRIMARY KEY, so a
-- double-click cannot inflate the count. `helpful_count` on the review is a
-- denormalised cache of `count(*)` here, maintained in the same statement as the
-- vote so the two cannot drift.
--
-- `player_id` CASCADEs: a vote is meaningless without its voter, exactly like
-- `player_favorites`.
CREATE TABLE IF NOT EXISTS review_helpful (
  review_id  BIGINT NOT NULL REFERENCES game_reviews(id) ON DELETE CASCADE,
  player_id  TEXT   NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, player_id)
);

CREATE INDEX IF NOT EXISTS review_helpful_player_idx ON review_helpful (player_id);

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
--
-- `reporter_id` is ON DELETE SET NULL, NOT CASCADE — deliberately the opposite
-- of the review itself. A report is a MODERATION SIGNAL, not speech: if it
-- cascaded, a reporter deleting their account would silently empty the queue and
-- undo any auto-hide their report had triggered. Postgres treats NULLs as
-- distinct in unique indexes, so the dedup index below still permits several
-- orphaned reports on one review, which is correct.
CREATE TABLE IF NOT EXISTS review_reports (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  review_id   BIGINT NOT NULL REFERENCES game_reviews(id) ON DELETE CASCADE,
  reporter_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL DEFAULT 'other'
                CONSTRAINT review_reports_reason
                CHECK (reason IN ('personal_info','bullying','hate','sexual','spam','impersonation','other')),
  status      TEXT NOT NULL DEFAULT 'open'
                CONSTRAINT review_reports_status CHECK (status IN ('open','actioned','dismissed')),
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

-- One report per person per review. The API returns ok either way, so it never
-- leaks whether you had already reported something.
CREATE UNIQUE INDEX IF NOT EXISTS review_reports_dedup_idx
  ON review_reports (review_id, reporter_id);

-- The moderation queue: open reports, newest first. Partial, because 'open' is a
-- small and self-clearing minority of a growing table.
CREATE INDEX IF NOT EXISTS review_reports_open_idx
  ON review_reports (created_at DESC) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS review_reports_reporter_idx
  ON review_reports (reporter_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Review bans
-- ---------------------------------------------------------------------------
--
-- NO FOREIGN KEY ON `player_id`, and this is the sharpest decision in the file.
-- `players.id` IS the Google subject id, which is STABLE across account deletion
-- and re-signup. With any FK, a banned pupil could delete their account from
-- /play/account — dropping the ban row — then sign in again with the SAME Google
-- account, receive the SAME players.id, and post freely. The ban has to outlive
-- the players row, and because the subject is stable it still matches on return.
--
-- Same reasoning as `player_blocks.blocked_id` in the social migration.
CREATE TABLE IF NOT EXISTS review_bans (
  player_id  TEXT PRIMARY KEY,
  reason     TEXT,
  expires_at TIMESTAMPTZ,               -- NULL = permanent
  created_by TEXT NOT NULL,             -- dashboard_users.email of the acting admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Moderation audit log
-- ---------------------------------------------------------------------------
--
-- `actor_email` is deliberately NOT a foreign key to `dashboard_users(email)`:
-- removing someone from the admin allow-list must not erase their audit trail.
CREATE TABLE IF NOT EXISTS review_moderation_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL
                CONSTRAINT review_moderation_log_action
                CHECK (action IN ('hide','unhide','delete','purge','dismiss','ban','unban','hide_backlog')),
  review_id   BIGINT,
  player_id   TEXT,
  slug        TEXT,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_moderation_log_created_idx
  ON review_moderation_log (created_at DESC);

COMMIT;
