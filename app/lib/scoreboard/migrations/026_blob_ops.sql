-- HallPass — migration: stop needing advanced Vercel Blob operations.
--
-- See `app/lib/blob-index.sql` and `app/lib/app-settings.sql` for the canonical
-- fresh-install DDL; keep all three in lockstep.
--
-- ── THE PROBLEM ─────────────────────────────────────────────────────────────
-- Vercel splits Blob operations into two billed classes with very different
-- allowances. On Hobby: 10,000 SIMPLE operations a month (`head`, `del`) and
-- only 2,000 ADVANCED ones (`put`, `copy`, `list`). The advanced budget is the
-- one this site exhausted, and the breakdown of a measured 30-day window says
-- why: 920 of 934 advanced operations were the single `list()` in
-- `app/lib/game-serving-blobs.ts` that discovers which games have a published
-- blob. It PAGINATES, so one refresh can be several operations, and it is on
-- the serving path for every game asset of every play.
--
-- When the advanced allowance runs out, `put` fails too — so the failure mode
-- is not "the site is a bit slower", it is "no admin can publish a game".
--
-- ── THE FIX, IN TWO PARTS ───────────────────────────────────────────────────
-- 1. `game_blobs` — mirror the `games/**` prefix in Neon. `put()` already
--    returns the public URL, so a writer that records what it wrote lets every
--    reader answer from the database instead of from Blob. This deletes the
--    `list()` from the serving path, from the dashboard's per-game file panel,
--    and from the stale-asset sweep in the three source mutators. Exactly the
--    lesson `015_game_media_url.sql` applied to screenshots, extended from "we
--    need this object's URL" to "we need to know which objects exist".
--
-- 2. `app_settings` — a key/value table holding (a) the games-version counter,
--    which retires the `games/version.txt` sentinel and with it one `put()` per
--    source change plus a `head()` per cache window, and (b) the per-feature
--    kill switches a super admin flips from `/dashboard/blob` when the advanced
--    allowance is spent and the remaining writes have to be rationed.
--
-- After this, the ONLY `list()` left in the application is `reindexGameBlobs()`,
-- which a super admin triggers by hand to resynchronise the mirror after an
-- out-of-band write. Steady-state advanced-operation spend goes from ~934/month
-- to one per published file.
--
-- ── NO BACKFILL HERE, DELIBERATELY ──────────────────────────────────────────
-- SQL cannot invent blob URLs; only a `list()` knows them. An EMPTY index reads
-- as "no game has a blob override", which the serving route already handles by
-- answering from the baked-in `public/games/` twin — the same degradation the
-- old `head()`-fails branch produced, and the state every game is in between a
-- `sync-games` run and the next upload. Run the "Rebuild index" button on
-- `/dashboard/blob` (one `list()`) immediately after deploying to restore the
-- overrides that predate this table.
--
-- Fully idempotent — every statement guarded, whole file in one transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS game_blobs (
  pathname    TEXT PRIMARY KEY
                CONSTRAINT game_blobs_pathname_prefix CHECK (pathname LIKE 'games/%'),
  slug        TEXT NOT NULL
                CONSTRAINT game_blobs_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  url         TEXT NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0
                CONSTRAINT game_blobs_size_nonneg CHECK (size >= 0),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS game_blobs_slug_idx ON game_blobs (slug);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY
               CONSTRAINT app_settings_key_length CHECK (char_length(key) BETWEEN 1 AND 128),
  value      TEXT NOT NULL
               CONSTRAINT app_settings_value_length CHECK (char_length(value) <= 4096),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

COMMIT;
