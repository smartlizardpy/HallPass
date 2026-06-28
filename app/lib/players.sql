-- HallPass — player identity schema.
--
-- A "player" is anyone who signs in with Google to TAG their leaderboard scores
-- with a verified identity (display name + avatar). This is a SEPARATE concern
-- from `dashboard_users` (see `auth.sql`): that table is the dashboard access
-- allow-list; this one is just an identity record. An admin is also a player —
-- the two tables coexist, keyed differently.
--
-- The PRIMARY KEY is the Google subject id (Auth.js `user.id`, i.e. the stable
-- `profile.sub`), NOT the email — emails can change, the subject cannot, and the
-- email is never exposed publicly. `email` is kept UNIQUE/NOT NULL for support
-- and dedup, but stays server-side. `handle` is the player's OPTIONAL override
-- of their display name; when null the effective display falls back to `name`
-- (the Google name) and ultimately a generic "Player".
--
-- Fresh installs: apply this file alongside `scoreboard/schema.sql` (the scores
-- table's `player_id` FK references `players(id)`). For an EXISTING database, run
-- the one-time `scoreboard/migrations/002_player_identity.sql` instead.

CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  image       TEXT,
  handle      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login  TIMESTAMPTZ
);
