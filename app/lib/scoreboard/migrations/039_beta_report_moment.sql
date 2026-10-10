-- HallPass — migration: record which game-reported moment a bug report pins.
--
-- See `app/lib/beta/schema.sql` for the canonical fresh-install DDL; keep the
-- two in lockstep.
--
-- WHY. A game can call `HallPass.moment("boss-phase-2", { level: 4 })` (SDK
-- 1.3.0). In a beta session that puts a picture of the game at that instant in the
-- tester's filmstrip. When the tester pins that picture to a bug report, the
-- report should carry WHICH moment it was and the game's own data for it - the
-- picture says what it looked like, the data (position, level, seed) says how to
-- get back there.
--
-- WHY TEXT, AND NO CHECK. `moment_data` is the game's JSON, held as text for the
-- reason `error_log` is (018): nothing queries inside it, and a payload that
-- misbehaves must degrade to "no moment shown" rather than fail the INSERT and
-- lose what the tester typed. The app validates and caps both columns before they
-- get here (`sdk/src/moment.ts`: 40 characters, about 2 KB).
--
-- Both nullable: most reports pin no moment, and one filed before this migration
-- cannot have one. Nothing is uploaded for a moment itself - the picture is the
-- ordinary `shot_*` evidence - so this adds no Blob operations.
--
-- Fully idempotent - every statement guarded, whole file in one transaction.

BEGIN;

ALTER TABLE beta_reports
  ADD COLUMN IF NOT EXISTS moment_name TEXT;

ALTER TABLE beta_reports
  ADD COLUMN IF NOT EXISTS moment_data TEXT;

COMMIT;
