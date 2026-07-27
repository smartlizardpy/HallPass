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

-- IDENTITY COLUMNS, and how the three name-ish fields differ — this is the part
-- that is easy to get wrong:
--
--   `name`     the Google display name. NEVER rendered publicly: for most
--              accounts it is the person's REAL NAME. Owner-facing surfaces only.
--   `handle`   the player's chosen free-form DISPLAY string. Not unique. Emoji
--              and spaces allowed. Coerced, never rejected (see `sanitizeHandle`).
--   `username` the unique, lowercase, ASCII PUBLIC ADDRESS at /u/<username>.
--              Validated with a reason, never coerced (see `app/lib/username.ts`).
--              Nullable forever: no username simply means no public profile and
--              not findable by search, which is a perfectly good state and the
--              right default here.
--
-- `public_id` is the id that goes ON THE WIRE. `id` is the Google subject — a
-- stable, cross-service correlation identifier for a minor — and a friends list, a
-- friend-request payload or a "friends who play this" row would otherwise put
-- OTHER PEOPLE's subject ids into the browser. `gen_random_uuid()` is built in on
-- PG13+ (Neon runs 16/17), so no extension is required.
--
-- `profile_visibility` defaults to 'friends' deliberately: a brand-new player's
-- profile leaks nothing until they choose to connect, while a link they share
-- still works well enough to receive a friend request.
--
-- Username case-insensitivity is achieved by STORING LOWERCASE, not by citext and
-- not by a functional index. Uppercase cannot exist in the column, so a plain
-- UNIQUE btree IS the case-insensitive index and every lookup is a plain equality
-- guaranteed to hit it. citext would drag an extension into this file forever and
-- fold case per database collation; `lower(username)` works but silently misses
-- the index whenever a future query forgets to wrap the column.
CREATE TABLE IF NOT EXISTS players (
  id                     TEXT PRIMARY KEY,
  email                  TEXT UNIQUE NOT NULL,
  name                   TEXT,
  image                  TEXT,
  handle                 TEXT,
  username               TEXT UNIQUE
                           CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$'),
  username_changed_at    TIMESTAMPTZ,
  friend_code            TEXT UNIQUE
                           CHECK (friend_code IS NULL OR friend_code ~ '^[0-9CDFGHJKMNPQRTVWXY]{8}$'),
  friend_code_rotated_at TIMESTAMPTZ,
  public_id              UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  profile_visibility     TEXT NOT NULL DEFAULT 'friends'
                           CHECK (profile_visibility IN ('public','friends','private')),
  handle_changed_at      TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login             TIMESTAMPTZ
);

-- Prefix search (`LIKE 'ab%'`) needs text_pattern_ops: a plain btree under a
-- non-C collation will NOT serve it, so without this the @-search seq-scans.
CREATE INDEX IF NOT EXISTS players_username_prefix_idx
  ON players (username text_pattern_ops);
