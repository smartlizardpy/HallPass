-- HallPass — migration: the social graph (usernames, friends, blocks, plays).
--
-- See `app/lib/social.sql` for the canonical fresh-install DDL and the full
-- reasoning; the two must be kept in lockstep. The decisions worth repeating here
-- are the ones that look like mistakes if you do not know why:
--
--   * `friendships` is ONE ROW PER PAIR with ordered keys, not two directed edges.
--     The `neon()` HTTP driver has no cross-statement transactions, so a two-row
--     design could not write both halves of an accept atomically and would leave
--     friendships half-present. One row makes accept a single UPDATE. It also
--     makes "no duplicate and no reciprocal-duplicate request" a consequence of
--     the PRIMARY KEY rather than something app code has to check and race on.
--
--   * `player_blocks.blocked_id` and `friend_request_attempts.target_id` have NO
--     foreign key, on purpose. `players.id` is the Google subject id, which is
--     STABLE across account deletion and re-signup. If those columns cascaded, a
--     harasser could self-delete (already possible from /play/account), wiping
--     every block against them and every cooldown they owed, then sign in again
--     with the same Google account, receive the same `players.id`, and resume.
--     The blocker's intent has to outlive the blocked party's account churn.
--
--   * `username_history.player_id` is ON DELETE SET NULL, not CASCADE, so a
--     deleted user's name stays quarantined rather than becoming instantly
--     claimable by whoever drove them off the platform.
--
-- Fully idempotent — every statement is guarded and the whole file runs in one
-- transaction — so it is safe to re-apply. Follows `004_player_favorites.sql`
-- rather than the "RUN ONCE" files. Postgres has no `ADD CONSTRAINT IF NOT
-- EXISTS`, hence the `pg_constraint` guards.

BEGIN;

-- ---------------------------------------------------------------------------
-- players: identity columns
-- ---------------------------------------------------------------------------

-- `username` is a UNIQUE, lowercase, ASCII handle — the public address at
-- /u/<username>. It is a SEPARATE concern from `handle`, which stays a free-form
-- display string (emoji and spaces allowed, not unique). Nullable forever: a
-- player without one simply has no public profile and is not searchable, which is
-- a perfectly good state and the correct default for this audience.
ALTER TABLE players ADD COLUMN IF NOT EXISTS username            TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;

-- Short out-of-band add code. Rotatable with no history table — the old code dies
-- instantly, which is the point for a player who posted theirs publicly.
ALTER TABLE players ADD COLUMN IF NOT EXISTS friend_code            TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS friend_code_rotated_at TIMESTAMPTZ;

-- The id that goes ON THE WIRE. `players.id` is the Google subject — a stable,
-- cross-service correlation identifier for a minor — and a friends list, a friend
-- request payload or a "friends who play this" row would all put OTHER PEOPLE's
-- subs into the browser. `public_id` exists so none of that is ever necessary.
-- `gen_random_uuid()` is built in on PG13+ (Neon runs 16/17), no extension needed,
-- and an ADD COLUMN with a volatile DEFAULT backfills existing rows in place.
ALTER TABLE players ADD COLUMN IF NOT EXISTS public_id UUID NOT NULL DEFAULT gen_random_uuid();

-- 'friends' is the default deliberately: a brand-new player's profile leaks
-- nothing until they choose to connect, while a link they share still works well
-- enough to receive a request.
ALTER TABLE players ADD COLUMN IF NOT EXISTS profile_visibility TEXT NOT NULL DEFAULT 'friends';

-- Closes a pre-existing gap: /api/v1/me/handle has no rate limit at all, so a
-- script could rewrite a leaderboard handle at line rate.
ALTER TABLE players ADD COLUMN IF NOT EXISTS handle_changed_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'players_username_format_chk') THEN
    ALTER TABLE players ADD CONSTRAINT players_username_format_chk
      -- 3..20 chars, lowercase alphanumeric + underscore, no leading/trailing
      -- underscore. Storing lowercase is what makes a plain UNIQUE index BE the
      -- case-insensitive index: uppercase cannot exist in the column, so every
      -- lookup is a plain equality that is guaranteed to hit it. citext would pull
      -- an extension into the fresh-install DDL forever and fold case per DB
      -- collation; a functional index on lower(username) works but silently misses
      -- whenever a future query forgets to wrap the column.
      CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'players_friend_code_format_chk') THEN
    ALTER TABLE players ADD CONSTRAINT players_friend_code_format_chk
      -- Confusable-free alphabet: digits plus consonants, with O/I/L/S/B/Z folded
      -- away on input and every vowel (A/E/U) excluded so codes cannot spell words.
      CHECK (friend_code IS NULL OR friend_code ~ '^[0-9CDFGHJKMNPQRTVWXY]{8}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'players_profile_visibility_chk') THEN
    ALTER TABLE players ADD CONSTRAINT players_profile_visibility_chk
      CHECK (profile_visibility IN ('public','friends','private'));
  END IF;
END $$;

-- CREATE UNIQUE INDEX rather than ALTER TABLE ... ADD CONSTRAINT UNIQUE: the
-- former is idempotent, which is exactly why 002 had to document itself run-once.
CREATE UNIQUE INDEX IF NOT EXISTS players_username_key    ON players (username);
CREATE UNIQUE INDEX IF NOT EXISTS players_friend_code_key ON players (friend_code);
CREATE UNIQUE INDEX IF NOT EXISTS players_public_id_key   ON players (public_id);

-- Prefix search (`LIKE 'ab%'`) needs text_pattern_ops: a plain btree under a
-- non-C collation will NOT serve it, so without this the @-search seq-scans.
CREATE INDEX IF NOT EXISTS players_username_prefix_idx
  ON players (username text_pattern_ops);

-- ---------------------------------------------------------------------------
-- friendships: one row per pair, ordered keys
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS friendships (
  player_a     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_b     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  PRIMARY KEY (player_a, player_b),
  -- COLLATE "C" is load-bearing and repo-specific. `players.id` is normally a
  -- numeric Google sub, but `app/lib/auth.ts` falls back to `user.id`, which is a
  -- HYPHENATED UUID — and hyphen ordering is exactly where ICU collations diverge
  -- from byte order. Without this pin, a lo/hi pair computed in JS (UTF-16 code
  -- unit order) could disagree with the CHECK under en_US.UTF-8 and reject a
  -- legitimate insert. `<` also excludes equality, so self-friendship is
  -- impossible at the database level and needs no application check.
  CONSTRAINT friendships_ordered_chk   CHECK ((player_a COLLATE "C") < (player_b COLLATE "C")),
  CONSTRAINT friendships_status_chk    CHECK (status IN ('pending','accepted')),
  CONSTRAINT friendships_requester_chk CHECK (requested_by IN (player_a, player_b))
);

-- The PK covers (player_a, ...); this covers the other direction, since every
-- read is `WHERE player_a = me OR player_b = me`.
CREATE INDEX IF NOT EXISTS friendships_b_idx ON friendships (player_b, player_a);
-- Partial indexes for the incoming/outgoing request badges: 'pending' is a small
-- minority of a growing table.
CREATE INDEX IF NOT EXISTS friendships_pending_a_idx ON friendships (player_a) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS friendships_pending_b_idx ON friendships (player_b) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- player_blocks: directional, non-mutual
-- ---------------------------------------------------------------------------

-- Deliberately NOT a 'blocked' status on `friendships`. Blocks are directional
-- and non-mutual: A blocks B, and B may independently block A. A shared pair row
-- can record only one blocker, so B's later block would overwrite A's — and A
-- unblocking would then delete the row and silently destroy B's block. That is a
-- safety bug, not an inconvenience.
--
-- Blocking DELETES the friendship row, so an accepted friendship and a block can
-- never coexist. That is why the "friends who play this" query needs no block
-- filter at all.
CREATE TABLE IF NOT EXISTS player_blocks (
  blocker_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL,  -- NO foreign key: see the header note on ban evasion
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT player_blocks_self_chk CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS player_blocks_blocked_idx ON player_blocks (blocked_id);

-- ---------------------------------------------------------------------------
-- friend_request_attempts: bounded rate-limit + cooldown state
-- ---------------------------------------------------------------------------

-- ONE ROW PER PAIR, upserted — not an append-only log. There is no cron in this
-- repo, so an append-only table would grow forever with nothing to prune it. One
-- row per pair bounds the table at players x distinct-targets-ever, so it needs no
-- pruning, and BOTH limits fall out of the same row: the pair cooldown is a PK
-- lookup, and the per-hour rate is a count over `created_at`, which correctly
-- means "N distinct targets per hour" since repeats are already cooldown-blocked.
--
-- This row is also what lets a DECLINE delete the friendship row outright: the
-- cooldown outlives the decline, so the requester cannot immediately re-send, and
-- the friendships table never has to carry dead 'declined' state that would
-- otherwise need a sweeper nobody has.
CREATE TABLE IF NOT EXISTS friend_request_attempts (
  requester_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  target_id     TEXT NOT NULL,  -- no FK: a cooldown you OWE must not reset
  attempt_count INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id)
);

CREATE INDEX IF NOT EXISTS friend_request_attempts_recent_idx
  ON friend_request_attempts (requester_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- username_history: rename + deletion tombstones
-- ---------------------------------------------------------------------------

-- A released username is quarantined for a while before anyone else can claim it.
-- Without this, renaming to escape someone hands them the name you just left, and
-- deleting your account hands it to whoever drove you off.
CREATE TABLE IF NOT EXISTS username_history (
  username    TEXT PRIMARY KEY,
  player_id   TEXT REFERENCES players(id) ON DELETE SET NULL,
  released_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS username_history_released_idx ON username_history (released_at DESC);

-- ---------------------------------------------------------------------------
-- player_plays: per-player play index
-- ---------------------------------------------------------------------------

-- The minimum addition that makes "which games do my friends play" answerable.
-- Today that data exists only as a PostHog 30-day aggregate with no per-player
-- dimension, and as `hp:recent` in localStorage, which is per-device and never
-- synced — neither can answer it.
--
-- ONE ROW PER (player, game), UPSERTED, never appended. An append-only log at a
-- realistic ~40k game-opens/day would be ~14.6M rows/year; the upsert converges to
-- players x distinct-games-played and stays there. Combined with a client-side
-- debounce and recording only for signed-in players, the write path is roughly
-- 0.03 writes/second — unremarkable on a driver with no connection pooling.
--
-- `slug` is not a foreign key, for the same reason as everywhere else here: games
-- are a static TS array plus `external_games`, not a table.
CREATE TABLE IF NOT EXISTS player_plays (
  player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  play_count   INTEGER NOT NULL DEFAULT 1,
  first_played TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_played  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, slug)
);

-- "what has this player played lately" (profile) …
CREATE INDEX IF NOT EXISTS player_plays_recent_idx ON player_plays (player_id, last_played DESC);
-- … and "who has played this game lately" (friends-who-play).
CREATE INDEX IF NOT EXISTS player_plays_slug_idx   ON player_plays (slug, last_played DESC);

COMMIT;
