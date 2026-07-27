-- HallPass — the social graph for a FRESH database.
--
-- Friends, blocks, username tombstones, per-player play history — and
-- `player_favorites`, which is folded in here because it previously existed ONLY
-- inside `scoreboard/migrations/004_player_favorites.sql`. That was a real
-- fresh-install gap: a brand-new database built from the canonical `.sql` files
-- would have had no favorites table at all.
--
-- The identity COLUMNS these tables depend on (`username`, `friend_code`,
-- `public_id`, `profile_visibility`) live in `app/lib/players.sql`, which must be
-- applied first — every table here references `players(id)`.
--
-- For an EXISTING database, run `scoreboard/migrations/007_social_graph.sql`
-- instead. The two must be kept in lockstep.

-- ---------------------------------------------------------------------------
-- friendships
-- ---------------------------------------------------------------------------
--
-- ONE ROW PER PAIR with ordered keys, not two directed edges. Three reasons, in
-- order of weight:
--
--   1. The `neon()` HTTP driver has no cross-statement transactions — each tagged
--      template call is an independent request. Two directed edges would need two
--      rows written atomically on accept, and without a transaction there is a
--      window where the friendship is half-present (A sees B as a friend, B does
--      not see A). One row makes accept a single `UPDATE ... RETURNING`, atomic by
--      definition. This is the decisive argument in THIS codebase.
--   2. "No duplicate and no reciprocal-duplicate request" becomes a consequence of
--      the PRIMARY KEY, for free: A->B and B->A are literally the same row, so a
--      reciprocal request cannot create a second one. Two-row edges need a partial
--      unique index PLUS an application-level check, and still race when two
--      opposite requests arrive at once.
--   3. Crossed requests auto-accept in one statement, via
--      `ON CONFLICT ... DO UPDATE SET status='accepted' WHERE status='pending' AND
--      requested_by <> $me` — no background reconciler.
--
-- The cost is on the read side (`WHERE player_a = $me OR player_b = $me` plus a
-- CASE to pick the other end, and two indexes instead of one). At a few hundred
-- rows per player that is nothing.

CREATE TABLE IF NOT EXISTS friendships (
  player_a     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_b     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  PRIMARY KEY (player_a, player_b),
  -- COLLATE "C" is load-bearing and specific to this codebase. `players.id` is
  -- normally a numeric Google subject id, but `app/lib/auth.ts` falls back to
  -- `user.id`, which is a HYPHENATED UUID — and hyphen ordering is precisely where
  -- ICU collations diverge from byte order. Without the pin, a lo/hi pair computed
  -- in JS (UTF-16 code-unit order) could disagree with this CHECK under
  -- en_US.UTF-8 and reject a legitimate insert. `<` also excludes equality, so
  -- self-friendship is impossible at the database level with no app-side check.
  CONSTRAINT friendships_ordered_chk   CHECK ((player_a COLLATE "C") < (player_b COLLATE "C")),
  CONSTRAINT friendships_status_chk    CHECK (status IN ('pending','accepted')),
  CONSTRAINT friendships_requester_chk CHECK (requested_by IN (player_a, player_b))
);

CREATE INDEX IF NOT EXISTS friendships_b_idx        ON friendships (player_b, player_a);
CREATE INDEX IF NOT EXISTS friendships_pending_a_idx ON friendships (player_a) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS friendships_pending_b_idx ON friendships (player_b) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- player_blocks
-- ---------------------------------------------------------------------------
--
-- A separate table rather than a 'blocked' status on `friendships`, because
-- blocks are DIRECTIONAL and NON-MUTUAL. A shared pair row can record only one
-- blocker, so B blocking A after A blocked B would overwrite A's block — and A
-- later unblocking would delete the row and silently destroy B's. That is a
-- safety bug, not an inconvenience.
--
-- `blocked_id` has NO foreign key, deliberately. `players.id` is the Google
-- subject id, which is STABLE across account deletion and re-signup. A cascading
-- FK would let a harasser self-delete from /play/account — wiping every block
-- against them — then sign in again with the same Google account, receive the
-- same id, and resume. The blocker's intent must outlive the blocked party's
-- account churn, and because the id is stable the block still matches on return.
-- It leaves orphan ids behind, which is fine: they are opaque and only ever
-- compared for equality.
--
-- Blocking DELETES the friendship row, so an accepted friendship and a block can
-- never coexist — which is why the "friends who play this" query needs no block
-- filter at all.

CREATE TABLE IF NOT EXISTS player_blocks (
  blocker_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT player_blocks_self_chk CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS player_blocks_blocked_idx ON player_blocks (blocked_id);

-- ---------------------------------------------------------------------------
-- friend_request_attempts
-- ---------------------------------------------------------------------------
--
-- ONE ROW PER PAIR, upserted — not an append-only log. There is no scheduler in
-- this repo, so an append-only table would grow unboundedly with nothing to prune
-- it. One row per pair bounds the table at players x distinct-targets-ever, and
-- BOTH limits fall out of that single row: the pair cooldown is a primary-key
-- lookup, and the per-window rate is a count over `created_at` — which correctly
-- means "N distinct targets per window", since repeats to the same target are
-- already blocked by the cooldown.
--
-- This table is also what lets a DECLINE delete the friendship row outright. A
-- stored 'declined' status would either block re-friending forever (children
-- decline by accident constantly) or need a TTL sweeper nobody has; the cooldown
-- row persists independently, so the requester still cannot immediately re-send.
--
-- `target_id` has no FK for the same reason as `player_blocks.blocked_id`: a
-- cooldown you OWE someone must not reset because they deleted their account.

CREATE TABLE IF NOT EXISTS friend_request_attempts (
  requester_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  target_id     TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id)
);

CREATE INDEX IF NOT EXISTS friend_request_attempts_recent_idx
  ON friend_request_attempts (requester_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- username_history
-- ---------------------------------------------------------------------------
--
-- A released username is quarantined before anyone else may claim it. Without
-- this, renaming to escape someone hands them the name you just left — and
-- renaming to escape someone is one of the main reasons a person renames.
--
-- `player_id` is ON DELETE SET NULL, NOT CASCADE, so the tombstone survives the
-- player's deletion. Cascading would mean deleting your account instantly frees
-- your name to whoever drove you off the platform.

CREATE TABLE IF NOT EXISTS username_history (
  username    TEXT PRIMARY KEY,
  player_id   TEXT REFERENCES players(id) ON DELETE SET NULL,
  released_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS username_history_released_idx ON username_history (released_at DESC);

-- ---------------------------------------------------------------------------
-- player_plays
-- ---------------------------------------------------------------------------
--
-- The per-player play index that makes "which games do my friends play"
-- answerable at all. Today that data exists only as a PostHog 30-day aggregate
-- with no per-player dimension, and as `hp:recent` in localStorage, which is
-- per-device and never synced.
--
-- ONE ROW PER (player, game), UPSERTED. An append-only log at a realistic ~40k
-- game-opens/day would be ~14.6M rows/year; the upsert converges to
-- players x distinct-games-played and then stays flat forever. Combined with a
-- client-side debounce and recording only for signed-in players, the write path
-- is roughly 0.03 writes/second — unremarkable even on a driver with no pooling.
--
-- Deliberately NOT merged into `player_favorites`: a favorite is a deliberate
-- curation act and a play is ambient. Conflating them would make the heart icon
-- lie.

CREATE TABLE IF NOT EXISTS player_plays (
  player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  play_count   INTEGER NOT NULL DEFAULT 1,
  first_played TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_played  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, slug)
);

CREATE INDEX IF NOT EXISTS player_plays_recent_idx ON player_plays (player_id, last_played DESC);
CREATE INDEX IF NOT EXISTS player_plays_slug_idx   ON player_plays (slug, last_played DESC);

-- ---------------------------------------------------------------------------
-- player_favorites
-- ---------------------------------------------------------------------------
--
-- Canonically defined here because it previously existed only in
-- `scoreboard/migrations/004_player_favorites.sql` — so a fresh install from the
-- `.sql` files alone would have been missing it entirely.
--
-- The signed-in mirror of the browser's localStorage favorites list (see
-- `app/lib/personalization.ts`). The composite PRIMARY KEY makes a favorite
-- idempotent, so a repeat add is a no-op via `ON CONFLICT DO NOTHING`.
--
-- Note the deliberate FK asymmetry against `scores`: a score has standalone
-- meaning, so it DE-TAGS (ON DELETE SET NULL) when its player is removed, whereas
-- a favorite is meaningless without its owner and CASCADE-deletes. Anonymous
-- favorites never live here; they stay device-local.

CREATE TABLE IF NOT EXISTS player_favorites (
  player_id  TEXT        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slug       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, slug)
);

CREATE INDEX IF NOT EXISTS player_favorites_player_created_idx
  ON player_favorites (player_id, created_at DESC);
