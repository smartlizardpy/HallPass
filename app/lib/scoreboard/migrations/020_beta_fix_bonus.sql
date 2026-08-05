-- HallPass — migration: let one report earn a fix bonus on top of its acceptance.
--
-- See `app/lib/beta/schema.sql` for the canonical fresh-install DDL; keep the
-- two in lockstep.
--
-- WHY. Triage could say a report was right, but never that it was DEALT WITH.
-- "Fixed" closes that loop: it pays a flat bonus on top of whatever the report
-- already earned and removes the row, so the queue holds only work still
-- outstanding. The tester learns their report changed the game, which is the
-- only feedback the programme was missing.
--
-- WHAT ACTUALLY CHANGES. Exactly one index. `beta_xp_awards_report_uniq` allowed
-- ONE award per report, which was right when a report had exactly one outcome
-- and is wrong now that acceptance and the fix bonus are two separate ledger
-- lines against the same report. Widening the key to (report_id, reason) is the
-- same shape `beta_xp_awards_shot_reason_uniq` has used since 016 for precisely
-- this reason — a shot earns SHOT_XP on acceptance and COVER_PROMOTION_XP later.
--
-- IT DOES NOT WEAKEN THE DOUBLE-SUBMIT GUARD, which is the only thing the old
-- index existed for. Both paths derive `reason` deterministically from the
-- report's `kind` and `severity`, so a form submitted twice produces the same
-- string twice and the second insert still conflicts away. What is now possible
-- is two awards with DIFFERENT reasons, which is exactly the new feature.
--
-- NO STATUS VALUE IS ADDED. A fixed report is DELETED, not parked in a terminal
-- state, so 'fixed' never reaches the `status` CHECK. The XP survives that
-- delete because `beta_xp_awards.report_id` has been ON DELETE SET NULL since
-- 016, on the stated grounds that reversing paid XP is worse than a ledger line
-- with no live source. This migration is the first thing to actually rely on it.
--
-- SAFE ON EXISTING DATA. Every current row is unique on `report_id` alone and is
-- therefore unique on (report_id, reason) too, so the new index cannot fail to
-- build. Backward compatible in the other direction as well: code that predates
-- this deploy writes one award per report and never notices the wider key.
--
-- Fully idempotent — every statement guarded, whole file in one transaction.

BEGIN;

-- Drop before create: these are different indexes on the same table, and
-- leaving the old one in place would keep enforcing the single-award rule this
-- migration exists to lift.
DROP INDEX IF EXISTS beta_xp_awards_report_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS beta_xp_awards_report_reason_uniq
  ON beta_xp_awards (report_id, reason) WHERE report_id IS NOT NULL;

COMMIT;
