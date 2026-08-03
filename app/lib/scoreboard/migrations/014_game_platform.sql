-- HallPass — migration: which devices a game is playable on.
--
-- See `app/lib/games.sql` and `app/lib/external-games.sql` for the canonical
-- fresh-install DDL; keep all three in lockstep.
--
-- WHY. A phone visitor gets the same grid a desktop visitor gets, taps a
-- keyboard-controlled game, finds nothing responds to touch, and leaves. Tagging
-- each game lets the catalogue sort and label itself per device.
--
-- WHY TEXT + CHECK AND NOT A POSTGRES ENUM. An enum type is the obvious fit for
-- three fixed values and the wrong tool here: you cannot remove a value from one,
-- and adding a value has transaction caveats that make a routine migration
-- awkward. A CHECK constraint is a DROP/ADD away from meaning something else,
-- which is what you want from a column whose vocabulary is a product decision.
-- It also matches the neighbours — `category` is TEXT, `tags` is TEXT[].
--
-- WHY NULLABLE IN BOTH TABLES, INCLUDING `external_games`. NULL means UNKNOWN:
-- nobody has picked the game up on a phone and checked. That is not the same
-- statement as any of the three values, and it has to survive in the schema or
-- the code above it cannot tell "we checked, it is desktop-only" from "we never
-- looked". It is why this migration ships with no backfill: every existing row
-- is honestly unknown, and every read path renders unknown exactly as the site
-- rendered before this column existed.
--
-- This deliberately breaks the every-descriptive-column-is-NOT-NULL convention
-- of `external_games` (where only `cover_url` is nullable today). `NOT NULL
-- DEFAULT 'both'` would have made every external game that already exists claim
-- mobile support it has never been tested for — precisely the false assertion
-- this column exists to stop the site from making.
--
-- No index. The column is read as part of the whole-table catalogue scan that
-- `readOverrides`/`readExternalGames` already do (both `unstable_cache`d), never
-- as a WHERE predicate. Sorting and filtering by platform happens in the client,
-- on a list of 27-odd games.
--
-- Fully idempotent — every statement guarded, whole file in one transaction.

BEGIN;

-- `game_overrides` — the per-column override layer over the static catalogue in
-- `app/lib/games.ts`. NULL here keeps its usual meaning of "inherit the static
-- value", which for `platform` composes correctly: an untagged static entry with
-- no override row resolves to unknown, and an admin setting the tag in the
-- dashboard pins it without touching any other overridden field.
ALTER TABLE game_overrides
  ADD COLUMN IF NOT EXISTS platform TEXT;

ALTER TABLE game_overrides
  DROP CONSTRAINT IF EXISTS game_overrides_platform_valid;
ALTER TABLE game_overrides
  ADD CONSTRAINT game_overrides_platform_valid
    CHECK (platform IS NULL OR platform IN ('desktop', 'mobile', 'both'));

-- `external_games` — whole games hosted off-site. No static entry to inherit
-- from, so NULL here means unknown outright rather than "see the TS array".
ALTER TABLE external_games
  ADD COLUMN IF NOT EXISTS platform TEXT;

ALTER TABLE external_games
  DROP CONSTRAINT IF EXISTS external_games_platform_valid;
ALTER TABLE external_games
  ADD CONSTRAINT external_games_platform_valid
    CHECK (platform IS NULL OR platform IN ('desktop', 'mobile', 'both'));

COMMIT;
