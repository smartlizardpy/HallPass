-- HallPass dashboard — auth/roles schema.
--
-- The dashboard signs users in with Google (Auth.js v5, JWT sessions — no
-- adapter tables). Authorization is OURS: this table is the allow-list of who
-- may access the dashboard and at what level. A user not present here (and not
-- in the SUPER_ADMIN_EMAILS env allow-list) is denied sign-in entirely.
--
-- Roles, lowest to highest: 'beta_admin' (the beta programme only — send
-- playtests and triage what comes back; read-only everywhere else on the
-- dashboard), 'admin' (boards, games, scores, analytics) and 'super_admin'
-- (everything, incl. managing these users). Super admins listed in
-- SUPER_ADMIN_EMAILS are bootstrapped/auto-upserted on sign-in and cannot be
-- demoted from the UI.
--
-- The three are deliberately LINEAR — everything a beta admin may do an admin
-- may do, and so on up — because that is what lets one rank comparison in
-- `app/lib/permissions.ts` answer every guard. `requireRole` enforces that rank;
-- before 'beta_admin' existed it only enforced a level for 'super_admin', which
-- would have made a beta admin a full admin at every other call site.

CREATE TABLE IF NOT EXISTS dashboard_users (
  email       TEXT PRIMARY KEY,
  role        TEXT NOT NULL CHECK (role IN ('super_admin','admin','beta_admin')),
  name        TEXT,
  image       TEXT,
  invited_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login  TIMESTAMPTZ
);
