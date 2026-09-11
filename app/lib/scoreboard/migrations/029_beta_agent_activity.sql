-- HallPass — migration: what the bug-MCP agent is doing, for the dashboard.
--
-- See `app/lib/beta/schema.sql` for the canonical fresh-install DDL; keep the
-- two in lockstep. `agent-activity-design.md` is the full argument.
--
-- ── WHY A TRAIL EXISTS AT ALL ───────────────────────────────────────────────
-- The MCP's closing tools DELETE the report they act on and pay the tester from
-- the XP ledger (`bug-mcp-design.md` §3). That is deliberate, and it has a
-- consequence nobody sees until they are looking for it: after an agent has
-- worked the queue, the dashboard is missing exactly the rows that would have
-- explained what happened. This table is the account of it, rendered where the
-- work disappeared from.
--
-- ── report_id IS DELIBERATELY NOT A FOREIGN KEY ─────────────────────────────
-- Every other reference to a report in this schema is REFERENCES beta_reports
-- ON DELETE SET NULL, so a fixed report's XP award outlives the row it paid
-- for. That is right for the ledger and wrong here. The most important row this
-- table will ever hold is "marked report 42 fixed", and the write that produces
-- it is the write that deletes report 42 — SET NULL would blank the subject of
-- the sentence at the moment it was written. A plain BIGINT keeps the number,
-- which is all a feed needs; nothing joins on it, exactly as `slug` is never a
-- foreign key anywhere in this codebase.
--
-- ── THREE OUTCOMES, AND 'refused' IS THE POINT ──────────────────────────────
-- The MCP's writes return `applied: false` rather than throwing when their
-- WHERE matched nothing (someone else got there first, or the row is already
-- gone), and the tool layer reports that as a refusal rather than as success.
-- A feed that recorded a refused close as a close would tell an operator a bug
-- was dealt with when it was not — the exact failure the tool layer goes out of
-- its way to avoid.
--
-- ── RETENTION IS BY AGE, IN THE INSERT'S OWN STATEMENT ──────────────────────
-- One row per tool call, so a working agent fills this steadily and nothing
-- else would ever empty it. `store.ts`'s logAgentActivity writes through a
-- data-modifying CTE whose top-level statement deletes anything past the
-- window, keeping it one round trip — the neon() driver is one stateless
-- request per call, so two statements would not be one transaction anyway.
--
-- Fully idempotent — every statement guarded, whole file in one transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS beta_agent_activity (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Which credential did this: `MCP_ACTOR`, the same string the decision writes
  -- to beta_reports.resolved_by, so a line here is traceable to a ledger row.
  actor      TEXT NOT NULL,
  -- The MCP tool name, verbatim. Free text rather than a CHECK: the tool list
  -- lives in TypeScript and a constraint here would turn adding a tool into a
  -- migration, with the failure landing at runtime on a live agent.
  tool       TEXT NOT NULL,
  outcome    TEXT NOT NULL DEFAULT 'ok'
               CHECK (outcome IN ('ok','refused','failed')),
  -- See the header: not a foreign key, on purpose.
  report_id  BIGINT CHECK (report_id > 0),
  slug       TEXT CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  summary    TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The only read this table serves: the newest N lines, for the dashboard panel.
CREATE INDEX IF NOT EXISTS beta_agent_activity_recent_idx
  ON beta_agent_activity (created_at DESC);

COMMIT;
