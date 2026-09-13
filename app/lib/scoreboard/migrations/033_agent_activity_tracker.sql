-- HallPass — migration: let a line of the agent feed be about a TRACKER ITEM.
--
-- See `app/lib/beta/schema.sql` for the canonical fresh-install DDL; keep the
-- two in lockstep. `tracker-mcp-design.md` §4 is the full argument.
--
-- ── ONE FEED, NOT TWO ───────────────────────────────────────────────────────
-- The MCP now reaches the project tracker as well as the bug queue, and the
-- obvious shape — a second table for a second surface — is the wrong one. The
-- feed is not just rows, it is a RUN: one sequence of lines that ends when
-- `finish_agent_activity` deletes it or after thirty quiet minutes, and whose
-- disappearance from the dashboard is how an operator learns the agent stopped
-- (`agent-activity-design.md` §11). Two tables would be two runs, two idle
-- windows, two things to finish, and a `finish_agent_activity` that could not
-- honestly say whether anything was still working. One nullable column keeps
-- one answer to "is the agent running".
--
-- The `beta_` prefix on a table that now holds tracker lines is a real naming
-- smell, and it is the price of the above. Recorded here rather than left for
-- somebody to discover.
--
-- ── NOT A FOREIGN KEY, FOR 029'S REASON ─────────────────────────────────────
-- `report_id` is a plain BIGINT because ON DELETE SET NULL would blank the
-- subject of "marked report 42 fixed" in the very write that produced it. The
-- write that matters here is not a delete, but nothing joins on this column
-- either, and a feed whose two id columns behaved differently would be a puzzle
-- for the next reader. Same shape, same reasoning.
--
-- ── BOTH IDS AT ONCE IS ALLOWED, DELIBERATELY ───────────────────────────────
-- No CHECK forbids `report_id` and `tracker_item_id` being set together. The
-- case is real: an agent narrating "fixing report 42, which is tracker item 7"
-- is the most informative line this table can hold, and a constraint would
-- refuse exactly it.
--
-- ── THE WINDOW BEFORE THIS IS APPLIED ───────────────────────────────────────
-- `recordActivity` swallows its own errors (`mcp/activity-log.ts`), so a
-- deployment running the new code against a database without this column goes
-- on serving every tool call; the feed writes fail, are logged, and the green
-- markers never appear. That degradation is why this is an additive column on
-- a table that already exists rather than a new table with a new read path.
--
-- Idempotent: the column and index are guarded, and the CHECK is named and
-- dropped before it is added, so re-running cannot accumulate constraints.

BEGIN;

ALTER TABLE beta_agent_activity
  ADD COLUMN IF NOT EXISTS tracker_item_id BIGINT;

ALTER TABLE beta_agent_activity
  DROP CONSTRAINT IF EXISTS beta_agent_activity_tracker_item_id_check;

ALTER TABLE beta_agent_activity
  ADD CONSTRAINT beta_agent_activity_tracker_item_id_check
  CHECK (tracker_item_id IS NULL OR tracker_item_id > 0);

-- Serves the green marker's only read: the newest line per item, within the
-- idle window. Partial, because the bug lines are the majority and none of them
-- are ever an answer to it.
CREATE INDEX IF NOT EXISTS beta_agent_activity_tracker_idx
  ON beta_agent_activity (tracker_item_id, created_at DESC)
  WHERE tracker_item_id IS NOT NULL;

COMMIT;
