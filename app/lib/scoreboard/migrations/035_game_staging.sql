-- HallPass — migration: staged (beta-only) games and the tester-chosen cover.
--
-- See `app/lib/games.sql` and `app/lib/external-games.sql` for the canonical
-- fresh-install DDL; keep all three in lockstep.
--
-- WHY. A game can be shipped to beta testers before the public sees it. A
-- STAGED game is visible and playable only to beta testers and dashboard roles;
-- for everyone else every public surface behaves as if it does not exist. An
-- admin later presses Publish and the game goes live with no code change.
--
-- WHY `game_overrides.staged` IS NULLABLE (TRI-STATE). The static `staged?` flag
-- in `app/lib/games.ts` is the floor (the add-game skill writes it). NULL here
-- means "inherit the static value", the same meaning NULL has in every other
-- column of this table; a non-NULL value wins. Publishing writes `false`, which
-- beats a static `staged: true` without touching code.
--
-- WHY `external_games.staged` IS `NOT NULL DEFAULT false`. An external game has
-- no static entry to inherit from, so the row is the whole truth, and every
-- existing row is public today. The default keeps it that way.
--
-- WHY `game_overrides.cover_url`. The tester-picked cover shot is promoted to a
-- `game_media` row and served via `/game-media/...`; this column records which
-- URL the catalogue should use. NULL inherits (static `coverUrl`, then the
-- conventional `/games/<slug>/cover.png`).
--
-- READ THIS BEFORE DEPLOYING THE CODE. Every cached read here is fail-soft
-- (try/catch → `[]`), so if the code that selects these columns ships before this
-- migration runs, the whole override read throws and ALL overrides silently
-- vanish. Apply this to the database first.
--
-- No index: both tables are read as a whole-table catalogue scan, never filtered
-- by these columns.
--
-- Fully idempotent — every statement guarded, whole file in one transaction.

BEGIN;

ALTER TABLE game_overrides
  ADD COLUMN IF NOT EXISTS staged BOOLEAN;

ALTER TABLE game_overrides
  ADD COLUMN IF NOT EXISTS cover_url TEXT;

ALTER TABLE external_games
  ADD COLUMN IF NOT EXISTS staged BOOLEAN NOT NULL DEFAULT false;

COMMIT;
