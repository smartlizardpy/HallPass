-- HallPass — game media (screenshots) schema for a FRESH database.
--
-- Each row is ONE image belonging to a game's store page at `/game/<slug>`. This
-- is a third kind of game-adjacent table and it is worth being precise about how
-- it differs from the other two: `game_overrides` (`app/lib/games.sql`) patches
-- the descriptive COPY of a static catalogue entry, and `external_games`
-- (`app/lib/external-games.sql`) defines a WHOLE off-site game. This table adds
-- IMAGES to a game of either kind, and to static catalogue entries too.
--
-- `slug` is the join key back to the game and is intentionally NOT a foreign key
-- — games live in a static TS array plus `external_games`, not in one table —
-- mirroring `boards.game_slug`, `game_overrides.slug` and `external_games.slug`.
-- The slug is validated in app code at write time against the RESOLVED catalogue
-- (`isResolvedSlug`, i.e. static + overrides + external), never against the
-- static array alone; an external game is exactly the kind of game that most
-- needs screenshots, since it has no bundled cover of its own.
--
-- WHERE THE BYTES LIVE, and why the prefix matters. The file itself is a Vercel
-- Blob under `game-media/<slug>/<id>.<ext>`, and `blob_path` stores that key. It
-- is deliberately NOT under the `games/<slug>/` prefix used for game source, and
-- that separation is load-bearing rather than cosmetic — SEVEN existing
-- behaviours act on `games/`:
--   1. `writeGameHtml()` deletes every blob under `games/<slug>/` except index.html
--   2. `uploadBundleAction()` deletes every blob absent from the uploaded zip
--   3. `clearHtmlAction()` deletes every blob under the prefix
--   4. `scripts/sync-games.mjs` mirrors `games/**` into `public/games/` (i.e. into
--      the repo — screenshots would get committed)
--   5. `scripts/build-sw-manifest.mjs` sweeps `public/games/<slug>/**` into the
--      service-worker precache (every game's screenshots force-downloaded by
--      every visitor on SW install)
--   6. the dashboard games grid scans `list({prefix:"games/"})`
--   7. `countCustomFiles()` would report screenshots as published source files
-- `list({ prefix: "games/" })` does not match `game-media/`, so all seven are
-- avoided. Do NOT rename this to `games-media/` or `games/media/` — either would
-- collide with the prefix scan again.
--
-- `id` doubles as the blob filename stem and is randomly generated, and blobs are
-- written with `allowOverwrite: false`, so a given URL's bytes never change. That
-- is what lets the serving route send `Cache-Control: immutable`.
--
-- `width`/`height` are stored rather than derived so that every <img> can carry
-- explicit dimensions (no layout shift) and so `generateMetadata` can emit correct
-- OpenGraph image dimensions without reading the file.
--
-- `blob_url` exists for the same reason: it is what `put()` returned at upload
-- time, so the serving route never has to spend a billed `head()` just to learn
-- where the bytes live. It is NULLABLE because rows created before the column
-- existed cannot have it (only a Blob `list()` knows those URLs) — the route
-- treats NULL as "fall back to `head()` once and write the answer back", so the
-- table self-heals. See `scoreboard/migrations/015_game_media_url.sql`.
--
-- There is deliberately NO `UNIQUE (slug, position)`. Reordering under such a
-- constraint requires either deferrable constraints or a two-pass shuffle through
-- temporary values; instead the app rewrites every position for a slug in ONE
-- statement (`UPDATE ... FROM unnest($1::text[]) WITH ORDINALITY`), and reads sort
-- by `(position, created_at)` so duplicate positions degrade to insertion order
-- rather than to an error.
--
-- For an EXISTING database, run the one-time
-- `scoreboard/migrations/006_game_media.sql` instead.

CREATE TABLE IF NOT EXISTS game_media (
  id           TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
  slug         TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  kind         TEXT NOT NULL DEFAULT 'screenshot' CHECK (kind IN ('screenshot','hero')),
  blob_path    TEXT NOT NULL UNIQUE,
  blob_url     TEXT,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  width        INTEGER NOT NULL DEFAULT 0,
  height       INTEGER NOT NULL DEFAULT 0,
  bytes        INTEGER NOT NULL DEFAULT 0,
  alt          TEXT NOT NULL DEFAULT '',
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backs the only read shape there is: "every image for this slug, in display
-- order". `created_at` is the tiebreaker so equal positions fall back to
-- insertion order instead of an arbitrary heap order.
CREATE INDEX IF NOT EXISTS game_media_slug_position_idx
  ON game_media (slug, position ASC, created_at ASC);
