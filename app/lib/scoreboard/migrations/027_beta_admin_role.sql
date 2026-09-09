-- HallPass — migration: add the 'beta_admin' dashboard role.
--
-- See `app/lib/auth.sql` for the canonical fresh-install DDL; keep the two in
-- lockstep.
--
-- ── WHAT A BETA ADMIN IS ────────────────────────────────────────────────────
-- A third, LOWER rung on `dashboard_users.role`: someone trusted to run the
-- beta programme — send playtests, triage what comes back — and trusted with
-- nothing else. They may READ the rest of the dashboard and may write nowhere
-- outside `/dashboard/beta`; they cannot edit games, the catalogue, the
-- leaderboards, moderation or the tracker, and they cannot add or remove
-- testers (they raise a request an admin approves — see `028`).
--
-- ── WHY A ROLE AND NOT A FLAG ───────────────────────────────────────────────
-- The authorization model is already "one role per address, resolved on every
-- request" (`app/lib/auth.ts`), and a boolean beside it would be a second source
-- of truth for the same question. The cost is that `requireRole` had to stop
-- pretending to be a ladder — before this it only enforced a level for
-- `super_admin`, so ANY role passed `requireRole("admin")`. Adding a value here
-- without that change would have made every beta admin a full admin. The rank
-- map in `app/lib/permissions.ts` is the other half of this migration.
--
-- ── ORDERED, AND THE ORDER IS LOAD-BEARING ──────────────────────────────────
-- 'beta_admin' < 'admin' < 'super_admin'. Everything a beta admin may do, an
-- admin may do; everything an admin may do, a super admin may do. Keeping the
-- three genuinely linear is what lets one rank comparison answer every guard.
--
-- Idempotent: the constraint is dropped by name and re-added, so re-running is
-- a no-op rather than a duplicate-constraint error.

BEGIN;

ALTER TABLE dashboard_users
  DROP CONSTRAINT IF EXISTS dashboard_users_role_check;

ALTER TABLE dashboard_users
  ADD CONSTRAINT dashboard_users_role_check
  CHECK (role IN ('super_admin','admin','beta_admin'));

COMMIT;
