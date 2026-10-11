-- HallPass — migration: profile reports ("Report this player").
--
-- See `app/lib/profile-reports/schema.sql` for the canonical fresh-install DDL;
-- keep the two in lockstep. `docs/profile-reports-design.md` has the argument.
--
-- ONE ROW PER REPORT. A signed-in player reports another player's PROFILE (their
-- name, handle or picture, or how they behave), picking one reason and optionally
-- adding a short note. The wire format names players by `public_id` only; this
-- table stores the internal ids because every other player table does, and they
-- never leave the server.
--
-- ON DELETE, and why the two sides differ:
--   * `reporter_id` — SET NULL. A report about bullying must outlive the account
--     of the child who made it (the reporter deleting their account must not
--     quietly empty the queue or destroy the evidence). Nulling the id removes
--     the only link to that child; the report keeps its reason and note. Same
--     choice, same reason as `review_reports.reporter_id`.
--   * `reported_id` — CASCADE. When the reported child's account is deleted we
--     delete everything about them, and a report is data about them. Keeping it
--     would retain a child's data (and an allegation about them) after they asked
--     us to remove it. The cost: deleting the account ends the open report. That
--     is acceptable because the profile it was about is gone; a safeguarding
--     escalation is expected to be handled before then, outside this table.
--
-- `note` is free text typed by a child. It is capped at 300 characters here as
-- well as in the route, is shown to admins as TEXT, and is never shown to the
-- reported player or anybody else.
--
-- One OPEN report per (reporter, reported) pair: the partial unique index lets
-- the same person report the same profile again once the first is resolved (the
-- behaviour may have continued) but not stack up duplicates meanwhile. NULL
-- reporters are distinct in a unique index, so orphaned reports never collide.
--
-- Rate limits count this table's rows by `reporter_id`, so rows must outlive the
-- longest window (a day); the retention proposal in the design doc (90 days for
-- resolved reports) is far longer.
--
-- Fully idempotent — whole file in one transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS profile_reports (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  reported_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL
                CONSTRAINT profile_reports_reason_chk
                CHECK (reason IN ('bullying','inappropriate_name','inappropriate_content','impersonation','other')),
  note        TEXT
                CONSTRAINT profile_reports_note_chk
                CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 300),
  status      TEXT NOT NULL DEFAULT 'open'
                CONSTRAINT profile_reports_status_chk
                CHECK (status IN ('open','actioned','dismissed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  CONSTRAINT profile_reports_not_self_chk
    CHECK (reporter_id IS NULL OR reporter_id <> reported_id)
);

-- One open report per reporter per profile.
CREATE UNIQUE INDEX IF NOT EXISTS profile_reports_open_dedup_idx
  ON profile_reports (reporter_id, reported_id) WHERE status = 'open';

-- The moderation queue: open reports, newest first.
CREATE INDEX IF NOT EXISTS profile_reports_open_idx
  ON profile_reports (created_at DESC) WHERE status = 'open';

-- "How many open reports against this player".
CREATE INDEX IF NOT EXISTS profile_reports_reported_idx
  ON profile_reports (reported_id) WHERE status = 'open';

-- Reporter rate limits (rolling hour and day).
CREATE INDEX IF NOT EXISTS profile_reports_reporter_idx
  ON profile_reports (reporter_id, created_at DESC) WHERE reporter_id IS NOT NULL;

COMMIT;
