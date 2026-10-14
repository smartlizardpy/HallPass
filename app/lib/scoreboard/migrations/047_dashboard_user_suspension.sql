-- HallPass — migration: temporary suspension of a dashboard user.
--
-- See `app/lib/auth.sql` for the canonical fresh-install DDL; keep the two in
-- lockstep.
--
-- `suspended_until` is a timestamp, not a boolean, so a suspension LAPSES by
-- itself: while it is in the future `getUserRole` treats the row as if it did
-- not exist (no dashboard, no admin tools), and once it passes the row works
-- again with its role untouched. NULL means not suspended. The row, role and
-- history are kept, which is the difference from removing the user.
--
-- Idempotent: safe to re-run.

ALTER TABLE dashboard_users
  ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;
