-- HallPass — migration: carry the game's own JavaScript errors on a bug report.
--
-- See `app/lib/beta/schema.sql` for the canonical fresh-install DDL; keep the
-- two in lockstep.
--
-- WHY. When a game breaks, the exception is frequently the whole diagnosis — the
-- file, the line, the undefined property. No tester is ever going to open
-- devtools and paste a stack trace, and asking a child to would be asking the
-- wrong person. The session collects them silently, and this is where they land.
--
-- WHY TEXT AND NOT JSONB. Nothing queries inside this. It is written once and
-- read once, by a human, in the triage view; the app parses it back with
-- `JSON.parse`. JSONB would buy indexing and containment operators that no code
-- path wants, at the cost of the database rejecting a malformed payload — and a
-- malformed payload here should degrade to "no errors shown" rather than
-- failing the whole report insert and losing what the tester typed.
--
-- The application caps the payload before it arrives (25 entries, truncated
-- messages and stacks, consecutive duplicates collapsed to a count), so this
-- column cannot be used to store an unbounded blob of text.
--
-- `error_count` is denormalised alongside so the triage list can show "3 errors"
-- without parsing every row's JSON to render a summary badge.
--
-- Both nullable: most reports carry no errors, and reports filed before this
-- column existed cannot.
--
-- Fully idempotent — every statement guarded, whole file in one transaction.

BEGIN;

ALTER TABLE beta_reports
  ADD COLUMN IF NOT EXISTS error_log TEXT;

ALTER TABLE beta_reports
  ADD COLUMN IF NOT EXISTS error_count INTEGER NOT NULL DEFAULT 0;

COMMIT;
