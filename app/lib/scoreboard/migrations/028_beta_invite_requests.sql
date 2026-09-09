-- HallPass — migration: beta tester invites a beta admin can ASK for.
--
-- See `app/lib/beta/schema.sql` for the canonical fresh-install DDL; keep the
-- two in lockstep.
--
-- ── WHY MEMBERSHIP NEEDS A SECOND PERSON ────────────────────────────────────
-- A beta admin (migration 027) runs the programme: they send playtests and they
-- triage what comes back. Both are reversible and neither creates anything.
-- INVITING is different in kind — it puts a player inside a surface that PAYS
-- XP, and the person who invited them is also the person who triages their
-- reports. One account inviting a second account it controls is the whole
-- self-dealing loop in two clicks, and no amount of care in triage closes it.
--
-- So the invite splits in two: a beta admin raises a request here, and an admin
-- turns it into membership. An `admin` and above never touches this table —
-- they invite directly, exactly as before.
--
-- ── ONE OPEN REQUEST PER PLAYER ─────────────────────────────────────────────
-- The partial unique index is what makes a re-submitted form (or an impatient
-- second ask) a no-op instead of a queue with the same name in it four times.
-- Partial on `pending` deliberately: a player who was requested, denied and
-- later requested again is a NEW decision, and the history of both is worth
-- keeping — `decided_by`/`decided_at` are the record of who said yes or no.
--
-- ── STATUS IS KEPT, THE ROW IS NOT DELETED ──────────────────────────────────
-- Unlike a duplicate beta report, a decided request is not redundant: it is the
-- only place that records an admin approved a beta admin's ask. Approval writes
-- membership in `beta_testers`, whose `invited_by` credits the REQUESTER, so
-- without this row nothing would say who actually let them in.
--
-- Fully idempotent — every statement guarded, whole file in one transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS beta_invite_requests (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','denied')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by   TEXT,
  decided_at   TIMESTAMPTZ
);

-- At most one OPEN request per player; see the header.
CREATE UNIQUE INDEX IF NOT EXISTS beta_invite_requests_open_uniq
  ON beta_invite_requests (player_id) WHERE status = 'pending';

-- The approval queue: pending first, newest first within a status.
CREATE INDEX IF NOT EXISTS beta_invite_requests_status_idx
  ON beta_invite_requests (status, created_at DESC);

COMMIT;
