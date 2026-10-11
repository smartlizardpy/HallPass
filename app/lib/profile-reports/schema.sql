-- HallPass — profile reports: canonical fresh-install DDL.
--
-- Mirrors migrations/043_profile_reports.sql (which carries the reasoning); keep
-- the two in lockstep. Requires `players` (players.sql).

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

CREATE UNIQUE INDEX IF NOT EXISTS profile_reports_open_dedup_idx
  ON profile_reports (reporter_id, reported_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS profile_reports_open_idx
  ON profile_reports (created_at DESC) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS profile_reports_reported_idx
  ON profile_reports (reported_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS profile_reports_reporter_idx
  ON profile_reports (reporter_id, created_at DESC) WHERE reporter_id IS NOT NULL;
