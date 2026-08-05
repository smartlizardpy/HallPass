-- HallPass — the beta tester programme tables (fresh install).
--
-- The canonical DDL for a database being created from scratch. For an EXISTING
-- database, run the one-time `scoreboard/migrations/016_beta_program.sql`
-- instead — the two must stay in lockstep.
--
-- Read that migration's header for the design argument. In brief:
--
--   * Testers are PLAYERS with a programme membership, not dashboard users with
--     reduced powers, so membership hangs off `players` rather than extending
--     the two-value `dashboard_users.role` CHECK that `requireRole()` ladders
--     over. `app/lib/auth.ts` makes the identity/authorization split explicit.
--   * `slug` is never a foreign key anywhere in this codebase — the catalogue is
--     a static TS array merged with override tables — so every game-adjacent
--     table repeats the same CHECK and validates via `isResolvedSlug()`.
--   * XP is an append-only LEDGER summed on read, never a cached counter, for
--     the same reason `achievements.points` is.
--   * Membership/assignments/awards CASCADE from `players`; reports and shots
--     SET NULL, because the content outlives its author.
-- Programme membership. One row per invited player; `revoked_at` rather than a
-- DELETE so a revocation keeps its audit trail and the XP ledger's FK target.
CREATE TABLE IF NOT EXISTS beta_testers (
  player_id   TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  invited_by  TEXT,
  invited_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  notes       TEXT NOT NULL DEFAULT ''
);

-- One admin-issued playtest. UNIQUE (player_id, slug) so re-assigning the same
-- game to the same tester updates the brief instead of stacking duplicates in
-- their queue.
CREATE TABLE IF NOT EXISTS beta_assignments (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  assigned_by  TEXT,
  brief        TEXT NOT NULL DEFAULT '' CHECK (length(brief) <= 500),
  status       TEXT NOT NULL DEFAULT 'assigned'
                 CHECK (status IN ('assigned','in_progress','submitted','closed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (player_id, slug)
);

-- The tester's queue, newest first. Deliberately NOT partial on the open
-- statuses: /beta shows closed assignments too (a tester should see what they
-- have finished), so a partial index would miss half the page's reads.
CREATE INDEX IF NOT EXISTS beta_assignments_player_idx
  ON beta_assignments (player_id, created_at DESC);

-- A filed bug or feature request.
--
-- `severity` is NULL for features and required for bugs; enforced as a CHECK
-- rather than two tables because triage, XP and the queue UI are otherwise
-- identical, and splitting them would double every read for one nullable column.
CREATE TABLE IF NOT EXISTS beta_reports (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id      TEXT REFERENCES players(id) ON DELETE SET NULL,
  assignment_id  BIGINT REFERENCES beta_assignments(id) ON DELETE SET NULL,
  slug           TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  kind           TEXT NOT NULL CHECK (kind IN ('bug','feature')),
  severity       TEXT CHECK (severity IN ('cosmetic','minor','major','blocker')),
  title          TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body           TEXT NOT NULL CHECK (length(body) BETWEEN 10 AND 2000),
  status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','accepted','rejected','duplicate')),
  clip_blob_path TEXT,
  -- What upload() returned, so streaming a replay costs no billed head().
  clip_url       TEXT,
  -- Evidence pinned to the report by the tester, picked from the session's
  -- automatic gameplay grabs. Deliberately NOT a `beta_shots` row: that table
  -- stages images for a game's public gallery and feeds the admin's image
  -- review queue, which is no place for screenshots of things that are broken.
  -- `shot_url` is what `put()` returned, so triage renders it with no head().
  shot_blob_path TEXT,
  shot_url       TEXT,
  -- The game's own JavaScript errors, collected silently during the session.
  -- TEXT rather than JSONB deliberately: nothing queries inside it, and a
  -- malformed payload should degrade to "no errors shown" rather than fail the
  -- insert and lose what the tester typed. The app caps the payload before it
  -- gets here. `error_count` is denormalised so the triage list can badge a row
  -- without parsing every row's JSON.
  error_log      TEXT,
  error_count    INTEGER NOT NULL DEFAULT 0,
  clip_bytes     INTEGER NOT NULL DEFAULT 0,
  clip_ms        INTEGER NOT NULL DEFAULT 0,
  device         TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by    TEXT,
  resolved_at    TIMESTAMPTZ,
  CONSTRAINT beta_reports_severity_matches_kind
    CHECK ((kind = 'bug' AND severity IS NOT NULL)
        OR (kind = 'feature' AND severity IS NULL))
);

-- The triage queue: open reports first, newest first within a status.
CREATE INDEX IF NOT EXISTS beta_reports_status_idx
  ON beta_reports (status, created_at DESC);

-- One game's reports, for the per-game admin view.
CREATE INDEX IF NOT EXISTS beta_reports_slug_idx
  ON beta_reports (slug, created_at DESC);

-- A submitted image awaiting review.
--
-- A STAGING table, deliberately separate from `game_media`. Media rows are read
-- by every public gallery; parking unreviewed player uploads there would put one
-- forgotten `WHERE status = 'accepted'` between a stranger's screenshot and the
-- public site. Acceptance COPIES into `game_media` through the existing
-- `insertMedia()`, so the public path keeps exactly one meaning.
CREATE TABLE IF NOT EXISTS beta_shots (
  id                TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
  player_id         TEXT REFERENCES players(id) ON DELETE SET NULL,
  slug              TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  blob_path         TEXT NOT NULL UNIQUE,
  blob_url          TEXT,
  content_type      TEXT NOT NULL
                      CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  width             INTEGER NOT NULL DEFAULT 0,
  height            INTEGER NOT NULL DEFAULT 0,
  bytes             INTEGER NOT NULL DEFAULT 0,
  kind              TEXT NOT NULL DEFAULT 'screenshot'
                      CHECK (kind IN ('cover','screenshot')),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','rejected')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,
  promoted_media_id TEXT
);

CREATE INDEX IF NOT EXISTS beta_shots_status_idx
  ON beta_shots (status, created_at DESC);

-- The append-only XP ledger. `reason` is a short machine string ('bug:major',
-- 'shot:cover', …) so the tester's page can explain each line without joining
-- back to a row that may since have been re-triaged.
--
-- Both FKs are nullable and SET NULL: an award survives the deletion of the
-- report or shot that earned it, because reversing paid XP retroactively is a
-- worse outcome than a ledger line with no live source.
CREATE TABLE IF NOT EXISTS beta_xp_awards (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL CHECK (amount >= 0),
  reason     TEXT NOT NULL DEFAULT '',
  report_id  BIGINT REFERENCES beta_reports(id) ON DELETE SET NULL,
  shot_id    TEXT REFERENCES beta_shots(id) ON DELETE SET NULL,
  awarded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The sum-by-player read, which every tester page and the badge shelf perform.
CREATE INDEX IF NOT EXISTS beta_xp_awards_player_idx
  ON beta_xp_awards (player_id);

-- At most one award per report, and one per shot-and-reason. Triage is a single
-- statement combining a status UPDATE with this INSERT, but a double-submitted
-- admin form would otherwise pay twice for the same decision; the unique index
-- makes the second attempt a no-op rather than a duplicate credit.
CREATE UNIQUE INDEX IF NOT EXISTS beta_xp_awards_report_uniq
  ON beta_xp_awards (report_id) WHERE report_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS beta_xp_awards_shot_reason_uniq
  ON beta_xp_awards (shot_id, reason) WHERE shot_id IS NOT NULL;

