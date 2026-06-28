-- HallPass dashboard — auth/roles schema.
--
-- The dashboard signs users in with Google (Auth.js v5, JWT sessions — no
-- adapter tables). Authorization is OURS: this table is the allow-list of who
-- may access the dashboard and at what level. A user not present here (and not
-- in the SUPER_ADMIN_EMAILS env allow-list) is denied sign-in entirely.
--
-- Roles: 'super_admin' (everything incl. managing these users) and 'admin'
-- (boards, games, scores, analytics). Super admins listed in SUPER_ADMIN_EMAILS
-- are bootstrapped/auto-upserted on sign-in and cannot be demoted from the UI.

CREATE TABLE IF NOT EXISTS dashboard_users (
  email       TEXT PRIMARY KEY,
  role        TEXT NOT NULL CHECK (role IN ('super_admin','admin')),
  name        TEXT,
  image       TEXT,
  invited_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login  TIMESTAMPTZ
);
