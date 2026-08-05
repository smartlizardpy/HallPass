-- HallPass — migration: remember each screenshot's Vercel Blob URL.
--
-- See `app/lib/game-media.sql` for the canonical fresh-install DDL; keep the two
-- in lockstep.
--
-- WHY. `app/game-media/[slug]/[[...path]]/route.ts` streams a screenshot by
-- first calling `head(blob_path)` purely to learn the object's public URL, then
-- fetching that URL. Both are BILLED Vercel Blob "simple operations" — `head()`
-- explicitly, and the fetch because it passed `cache: "no-store"`, which forces
-- a cache MISS every time. A game page with a full 8-image gallery therefore
-- spent 16 operations per view against a Hobby allowance of 10,000/month.
--
-- `put()` already returns the URL at upload time. Storing it turns the read path
-- into pure database work: zero Blob operations, however many times the image is
-- served. This is the same lesson `app/lib/game-serving-blobs.ts` learned for
-- `/game-html/`, applied to the media twin that was missed.
--
-- WHY NULLABLE, AND WHY NO BACKFILL HERE. SQL cannot invent the URLs for rows
-- that already exist — only a Blob `list()` knows them. NULL therefore means
-- "not yet known", and the serving route treats it as a signal to fall back to
-- the old `head()` for that one request and write the answer back, so the table
-- self-heals under traffic. `scripts/backfill-media-urls.mjs` does the same job
-- in bulk from a single `list()` if you would rather not wait.
--
-- NO INDEX. The column is only ever SELECTed alongside a row already located by
-- `blob_path` (which is UNIQUE and therefore already indexed). It is never a
-- WHERE predicate.
--
-- Fully idempotent — every statement guarded, whole file in one transaction.

BEGIN;

ALTER TABLE game_media
  ADD COLUMN IF NOT EXISTS blob_url TEXT;

COMMIT;
