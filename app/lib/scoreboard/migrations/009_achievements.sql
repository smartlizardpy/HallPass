-- HallPass — migration: game achievements.
--
-- See `app/lib/achievements.sql` for the canonical fresh-install DDL; keep the
-- two in lockstep.
--
-- WHY THIS TABLE EXISTS AT ALL, given `app/lib/badges.ts` argues at length that
-- badges should be DERIVED and never stored.
--
-- That argument is correct and still stands for platform badges: "played five
-- games", "holds a first place", "wrote three reviews" are all pure functions of
-- rows that already exist, so deriving them means they are always exactly true
-- and adding one is a code change rather than a migration plus a backfill.
--
-- It cannot be stretched to cover GAME achievements. "Beat level 10 of Duskfall"
-- is not visible to the platform in any table, now or ever — only the game knows
-- it happened. There is nothing to derive it from. So an achievement unlock is a
-- genuinely new fact that must be written down, and this is the one place in the
-- badge system where storage is the right answer rather than the lazy one.
--
-- The two systems stay separate and complementary: `badges.ts` keeps deriving
-- platform badges, and it gains ONE new input (total achievement points) so a
-- prolific achievement hunter earns a derived badge too.
--
-- Fully idempotent — every statement guarded, whole file in one transaction —
-- following `004_player_favorites.sql` rather than the "RUN ONCE" migrations.

BEGIN;

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------
--
-- ADMIN-PROVISIONED, exactly like `boards`. A game unlocks by a stable string
-- key it chooses ("first-blood"); if that key is not already in this table the
-- unlock fails with `unknown-achievement`, the direct analogue of the
-- leaderboard's `409 Board not initialized`.
--
-- The alternative — let a game create achievements implicitly on first unlock —
-- is what most SDKs do and it is wrong here. It hands every embedded game
-- unbounded write access to a shared table, and a single typo'd key
-- ("frist-blood") silently mints a ghost achievement that nobody can see, earn
-- again, or delete. Requiring provisioning makes a typo a loud, harmless no-op.
CREATE TABLE IF NOT EXISTS achievements (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- The game this belongs to. NOT a foreign key, matching `boards.game_slug`,
  -- `game_overrides.slug`, `external_games.slug` and `game_media.slug`: the
  -- catalogue is a static TypeScript array merged with DB rows, so there is no
  -- table to point at.
  slug        TEXT NOT NULL
                CONSTRAINT achievements_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),

  -- The game's stable identifier for this achievement. Underscores are allowed
  -- here but not in `slug`, because game authors reach for snake_case and there
  -- is no URL to keep clean — this key never appears in a path.
  key         TEXT NOT NULL
                CONSTRAINT achievements_key_format CHECK (key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),

  name        TEXT NOT NULL
                CONSTRAINT achievements_name_length CHECK (char_length(name) BETWEEN 1 AND 60),
  description TEXT NOT NULL DEFAULT ''
                CONSTRAINT achievements_description_length CHECK (char_length(description) <= 200),

  -- A single emoji. The repo has no icon library and hand-draws its SVGs; the
  -- badge shelf already renders emoji, so this matches what is on screen today.
  icon        TEXT NOT NULL DEFAULT '🏅'
                CONSTRAINT achievements_icon_length CHECK (char_length(icon) BETWEEN 1 AND 8),

  points      INTEGER NOT NULL DEFAULT 10
                CONSTRAINT achievements_points_range CHECK (points BETWEEN 0 AND 1000),

  -- >1 makes this a PROGRESS achievement ("kill 100 zombies"); 1 is a plain
  -- unlock. One column covers both rather than a nullable second table.
  target      INTEGER NOT NULL DEFAULT 1
                CONSTRAINT achievements_target_range CHECK (target BETWEEN 1 AND 1000000),

  -- Hidden (name and description withheld) until the player earns it.
  secret      BOOLEAN NOT NULL DEFAULT false,

  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- THE constraint everything else depends on: it is what makes
-- `unlock("first-blood")` addressable from a game that has no idea what numeric
-- id the row was given.
CREATE UNIQUE INDEX IF NOT EXISTS achievements_slug_key_idx
  ON achievements (slug, key);

-- The catalogue read for one game's store page / dashboard panel.
CREATE INDEX IF NOT EXISTS achievements_slug_position_idx
  ON achievements (slug, position ASC, id ASC);

-- ---------------------------------------------------------------------------
-- Unlocks and progress
-- ---------------------------------------------------------------------------
--
-- ONE ROW covers both states: `unlocked_at IS NULL` means in progress,
-- non-NULL means earned. A separate `player_achievement_progress` table would
-- need a join on every read and a transaction to move a row between them — and
-- the `neon()` HTTP driver cannot hold a transaction across two statements.
CREATE TABLE IF NOT EXISTS player_achievements (
  -- CASCADE, like `player_favorites` and `review_helpful`, and deliberately
  -- unlike `scores.player_id` (ON DELETE SET NULL). A score is a standalone
  -- public FACT — "someone reached 9000" stays true and stays ranked, so
  -- de-tagging it preserves competitive integrity. An achievement is not
  -- public and not ranked: an orphaned one belongs to nobody, is unreachable
  -- from any page, and just accumulates.
  player_id      TEXT   NOT NULL REFERENCES players(id) ON DELETE CASCADE,

  -- CASCADE so deleting a mis-authored achievement cleans up after itself.
  -- Deliberate contrast with reviews, where a tombstone preserves an evidence
  -- trail: there is no evidence trail worth keeping for a deleted achievement,
  -- and leaving orphaned unlock rows would resurrect them if the id were reused.
  achievement_id BIGINT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,

  -- ABSOLUTE, never a delta. See the write path in `app/lib/achievements/store.ts`:
  -- the SDK reports "the player is at 57", not "add 3", and the upsert takes
  -- GREATEST(existing, incoming). A retried, duplicated or out-of-order beacon
  -- therefore cannot double-count or regress a counter. Same reasoning as
  -- `player_plays` upserting rather than appending.
  progress       INTEGER NOT NULL DEFAULT 0
                   CONSTRAINT player_achievements_progress_range CHECK (progress >= 0),

  unlocked_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (player_id, achievement_id)
);

-- "Everything this player has earned", for the profile and the account page.
-- Partial: the overwhelming majority of reads want earned ones only.
CREATE INDEX IF NOT EXISTS player_achievements_earned_idx
  ON player_achievements (player_id, unlocked_at DESC)
  WHERE unlocked_at IS NOT NULL;

-- "How many players have this", for a rarity percentage on the store page.
CREATE INDEX IF NOT EXISTS player_achievements_achievement_idx
  ON player_achievements (achievement_id)
  WHERE unlocked_at IS NOT NULL;

-- Per-player write rate limiting reads the most recent writes for one player.
CREATE INDEX IF NOT EXISTS player_achievements_recent_idx
  ON player_achievements (player_id, updated_at DESC);

COMMIT;
