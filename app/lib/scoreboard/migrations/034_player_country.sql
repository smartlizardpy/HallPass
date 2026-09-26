-- HallPass — migration: signed-in users' country, for broad audience analytics.
--
-- Adds `players.country`, the ISO 3166-1 alpha-2 code of where a player's
-- HallPass account was FIRST detected (e.g. `GB`, `US`, `IQ`, `TR`). See
-- `players.sql` for the canonical fresh-install DDL; keep the two in lockstep.
--
-- ── COUNTRY ONLY, NEVER FINER-GRAINED ───────────────────────────────────────
-- This column exists for "where is the community coming from" dashboard
-- analytics, not location tracking. No city, region, postcode or coordinates
-- are ever written here — `app/lib/geo.ts` only ever hands the store a
-- 2-letter code (or nothing), so there is nothing finer-grained to strip.
--
-- ── FIRST DETECTED, NOT CONTINUOUSLY TRACKED ────────────────────────────────
-- The write path (`upsertPlayerOnLogin`) sets this column ONLY on the initial
-- INSERT, the same way it already leaves `handle` out of its `ON CONFLICT ...
-- DO UPDATE SET` list — a returning player signing in from a different
-- network (a new school, a VPN, a holiday) must not overwrite where their
-- account was first seen. NULL means "could not be determined" and reads as
-- "Unknown" on the dashboard, not as a guess.
--
-- Idempotent: additive column, guarded constraint, safe to re-run.

BEGIN;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS country CHAR(2);

ALTER TABLE players
  DROP CONSTRAINT IF EXISTS players_country_check;

ALTER TABLE players
  ADD CONSTRAINT players_country_check
  CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');

COMMIT;
