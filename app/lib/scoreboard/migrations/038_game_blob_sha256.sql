-- HallPass — migration: a content fingerprint on every indexed game blob.
--
-- Adds `game_blobs.sha256`, the SHA-256 (lowercase hex) of the bytes a writer
-- put at that pathname. See `app/lib/blob-index.sql` for the canonical
-- fresh-install DDL; keep the two in lockstep.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- Publishing a game costs one billed `put()` per file — an ADVANCED Blob
-- operation, 2,000 a month on Hobby — and a re-upload paid it for EVERY file,
-- changed or not: a one-line fix to a 300-file bundle cost 300. With the
-- fingerprint recorded, the dashboard's publishers skip any file whose bytes
-- already match what is published (`app/dashboard/(app)/games/actions.ts`), so
-- that fix costs 1. A skipped file also keeps its `uploaded_at`, so it goes on
-- being served from the free static mirror instead of being proxied from Blob
-- until the next deploy.
--
-- ── NULL MEANS "UNKNOWN", AND THAT IS THE SAFE DIRECTION ────────────────────
-- A row may only carry the fingerprint of the bytes actually in the store. A
-- writer that does not compute one (the reindex sweep, the external-games cover
-- cache) writes NULL over it, and NULL never matches, so that file is simply
-- written in full next time. A STALE fingerprint would be the dangerous case —
-- it would skip a write that was needed — which is why an out-of-band write
-- (`scripts/publish-game.mjs`, an edit in the Vercel dashboard) must be followed
-- by the reindex button on `/dashboard/blob`, exactly as it already must be for
-- the serving index to see it.
--
-- Rows written before this migration are NULL, so each file's first publish
-- afterwards is a full write that records its fingerprint.
--
-- The application tolerates this migration not having run yet: the writer
-- falls back to the old column list and the reader to "no fingerprints", which
-- is the behaviour from before it existed.
--
-- Idempotent: additive column, guarded constraint, safe to re-run.

BEGIN;

ALTER TABLE game_blobs
  ADD COLUMN IF NOT EXISTS sha256 TEXT;

ALTER TABLE game_blobs
  DROP CONSTRAINT IF EXISTS game_blobs_sha256_format;

ALTER TABLE game_blobs
  ADD CONSTRAINT game_blobs_sha256_format
  CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');

COMMIT;
