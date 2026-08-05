-- HallPass — migration: attach a screenshot to a beta bug report.
--
-- See `app/lib/beta/schema.sql` for the canonical fresh-install DDL; keep the
-- two in lockstep.
--
-- WHY. A bug report reading "the score resets when you pause" is a claim; the
-- same report with the moment on screen is evidence. The session already grabs
-- gameplay stills automatically, so the tester has one to hand — this is what
-- lets them pin it to the report instead of describing it.
--
-- WHY NOT REUSE `beta_shots`. That table is a STAGING AREA for images being
-- considered for a game's public gallery, and it feeds the admin's image-review
-- queue. Bug evidence is not gallery material: routing it through the same table
-- would fill that queue with screenshots of things that are broken, which is the
-- exact opposite of what it is for. Two columns on the report keep the two
-- purposes apart, and the object still lives under the same `beta-shots/` prefix.
--
-- WHY TWO COLUMNS AND NOT ONE. `shot_blob_path` is the Blob key, needed to
-- DELETE the object when the report is resolved; `shot_url` is what `put()`
-- returned, so rendering the evidence in triage costs no `head()` — the same
-- lesson `015_game_media_url.sql` applies to the gallery.
--
-- Both nullable: most reports have no screenshot, and a report filed before this
-- column existed cannot have one.
--
-- Fully idempotent — every statement guarded, whole file in one transaction.

BEGIN;

ALTER TABLE beta_reports
  ADD COLUMN IF NOT EXISTS shot_blob_path TEXT;

ALTER TABLE beta_reports
  ADD COLUMN IF NOT EXISTS shot_url TEXT;

COMMIT;
