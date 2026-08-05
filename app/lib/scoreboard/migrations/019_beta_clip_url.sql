-- HallPass — migration: remember a replay clip's URL.
--
-- See `app/lib/beta/schema.sql` for the canonical fresh-install DDL; keep the
-- two in lockstep.
--
-- WHY A SEPARATE MIGRATION FROM 018. That one is already applied to the dev
-- branch and its checksum is recorded in `schema_migrations`; editing it now
-- would trip the runner's mismatch warning for no benefit. A new file is the
-- cheaper honest option.
--
-- WHY THE COLUMN EXISTS. `/api/v1/beta/clips/[id]` streams the recording to the
-- tester who filed the report and to admins, and needs the object's URL to do
-- it. The alternatives are both worse: `head()` is a BILLED Vercel Blob simple
-- operation on every playback, and reconstructing the URL from an env var means
-- the route silently breaks the day the store is renamed or moved.
--
-- The browser uploads a clip directly to Blob storage (the file exceeds the
-- 4.5 MB request-body cap a Server Action is subject to) and `upload()` hands
-- back the URL, so it costs nothing to record. Same lesson as
-- `015_game_media_url.sql`.
--
-- Nullable: most reports have no clip.
--
-- Fully idempotent — every statement guarded, whole file in one transaction.

BEGIN;

ALTER TABLE beta_reports
  ADD COLUMN IF NOT EXISTS clip_url TEXT;

COMMIT;
