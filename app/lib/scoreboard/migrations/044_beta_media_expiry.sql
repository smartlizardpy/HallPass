-- HallPass — migration: remember that a report's clip/screenshot was expired.
--
-- See `app/lib/beta/schema.sql` for the canonical fresh-install DDL; keep the
-- two in lockstep.
--
-- WHY. Beta clips and screenshots are deleted `CLIP_RETENTION_DAYS` (30) after a
-- report is filed (`app/lib/beta/media-cleanup.ts`). The report text stays, so
-- the dashboard and the bug MCP need a way to say "the evidence was removed on
-- schedule" rather than showing a report that looks as if it never had any.
-- `media_expired_at` is that marker: set by the sweep when it clears the media
-- pointers, null for every report that still has its media or never had any.
--
-- Nullable, no default, no backfill: nothing has been expired yet. Run this
-- BEFORE deploying the code that reads it - the report queries select the column.
--
-- Fully idempotent - every statement guarded, whole file in one transaction.

BEGIN;

ALTER TABLE beta_reports
  ADD COLUMN IF NOT EXISTS media_expired_at TIMESTAMPTZ;

COMMIT;
