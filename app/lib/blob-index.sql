-- HallPass — the Neon mirror of the `games/**` Vercel Blob prefix.
-- Canonical fresh-install DDL.
--
-- Kept in lockstep with `app/lib/scoreboard/migrations/026_blob_ops.sql`, which
-- is the same body wrapped in BEGIN/COMMIT. Read that file for the full
-- reasoning; the short version is below.
--
-- WHY THIS TABLE EXISTS. Vercel bills `list()` as an ADVANCED Blob operation
-- (Hobby allowance: 2,000/month, a twentieth of the simple-operation budget),
-- and listing `games/**` was 920 of 934 measured advanced operations in a
-- 30-day window — 98% of every advanced operation the site spent, and ~46% of
-- the whole monthly allowance. `app/lib/game-serving-blobs.ts` had already
-- collapsed the per-asset `head()` storm into ONE cached `list()`; this table
-- finishes the job by removing the `list()` too.
--
-- The insight is the one `015_game_media_url.sql` wrote up for screenshots:
-- `put()` ALREADY RETURNS everything a reader needs (the public `url`), so a
-- writer that records what it wrote turns the read path into pure database
-- work — zero Blob operations, however many times a game is played. The
-- difference here is that the reader also needs to know which blobs EXIST, so
-- the mirror has to be a table of its own rather than a column on an existing
-- one.
--
-- THE INVARIANT. Every writer of a `games/**` blob records its row in the same
-- action, and every deleter forgets it. Those writers are enumerated in
-- `app/lib/game-blob-index.ts`; adding a new one without indexing it makes the
-- blob invisible to the serving route, which then answers from the baked-in
-- `public/games/` twin instead. That is a DEGRADATION, never a 404 — the same
-- fail-soft the old `head()`-fails branch had — which is why the index can be
-- rebuilt lazily rather than being a correctness cliff.
--
-- OUT-OF-BAND WRITES (editing a blob in the Vercel dashboard, `publish-game.mjs`
-- run against production) cannot be observed from here. `reindexGameBlobs()`,
-- exposed as a super-admin button on `/dashboard/blob`, spends ONE deliberate
-- `list()` sweep to resynchronise. That is the only `list()` left in the app.

CREATE TABLE IF NOT EXISTS game_blobs (
  -- The blob key, which is also the identity of the object: `put()` is called
  -- with `addRandomSuffix: false` everywhere under this prefix, so the key is
  -- stable across re-publishes and PRIMARY KEY makes the writer's record an
  -- idempotent upsert rather than an append.
  --
  -- The CHECK is a storage-layer guard against the one mistake that would be
  -- expensive: indexing `game-media/**` or `beta-shots/**` here. Those prefixes
  -- carry their own URL columns and are swept by different behaviours (see
  -- `app/lib/game-media.sql`); mixing them in would put screenshots into the
  -- serving route's map and into `sync-games.mjs`'s mirror.
  pathname    TEXT PRIMARY KEY
                CONSTRAINT game_blobs_pathname_prefix CHECK (pathname LIKE 'games/%'),

  -- The game this blob belongs to, i.e. the segment after `games/`. Stored
  -- rather than derived because every per-game read (`listGameFiles`, the stale
  -- sweep in `uploadBundleAction`) filters on it, and `split_part()` in a WHERE
  -- clause cannot use an index. Same lowercase-slug format as `game_overrides`.
  slug        TEXT NOT NULL
                CONSTRAINT game_blobs_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),

  -- The public Blob URL, exactly as `put()` returned it. This is the whole
  -- point of the table: the serving route proxies these bytes without ever
  -- asking Blob where they live.
  url         TEXT NOT NULL,

  -- Declared size in bytes. Only the dashboard's file-count/size panel reads it,
  -- so a wrong value is cosmetic — but it is free to record at write time and
  -- expensive to rediscover.
  size        INTEGER NOT NULL DEFAULT 0
                CONSTRAINT game_blobs_size_nonneg CHECK (size >= 0),

  -- When the object was written. `chooseGameSource()` compares this against the
  -- mirror stamp to decide free-CDN-twin versus paid proxy, so it must be the
  -- WRITE time and not the row's insert time on a reindex — `reindexGameBlobs()`
  -- carries `uploadedAt` over from the listing rather than defaulting it.
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Covers the per-game reads and the per-game delete sweep. The full-table read
-- the serving route uses needs no index at all: it is an unfiltered SELECT of a
-- table bounded by the corpus (a few hundred rows).
CREATE INDEX IF NOT EXISTS game_blobs_slug_idx ON game_blobs (slug);
