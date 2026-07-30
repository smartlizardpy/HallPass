-- HallPass — migration: a game's gameplay/intro video.
--
-- See `app/lib/game-videos.sql` for the canonical fresh-install DDL; keep the two
-- in lockstep.
--
-- WHY A VIDEO AT ALL. A store page currently shows stills, and a still cannot
-- answer the only question a visitor actually has — "what is this like to play".
-- Screenshots of a physics game in particular are nearly worthless.
--
-- WHY YOUTUBE RATHER THAN OUR OWN BYTES. Self-hosting meant a transcode pipeline,
-- poster extraction, and 8 MB objects in Blob per game; the whole `game_media`
-- upload path exists for images and would have needed a video twin. An id in a
-- table costs one column.
--
-- The tradeoff that shapes the UI: a lot of this site's audience is on school
-- networks where the filter that blocks game sites also blocks youtube.com. So
-- `GameTrailer` posters the video with the game's OWN screenshot and only creates
-- the iframe on click, then falls back to the gallery if the frame never loads.
-- Nothing about that is visible here, but it is why this table is allowed to be
-- this small — the resilience lives in the component, not the schema.
--
-- Fully idempotent — every statement guarded, whole file in one transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS game_videos (
  -- PRIMARY KEY ON slug means ONE video per game, and makes the write an upsert
  -- rather than an append. Deliberate: `game_media` is a gallery with positions
  -- and a reorder query because screenshots are plural; a trailer is not. If a
  -- second video is ever wanted, that is a new migration adding a position
  -- column, not a reason to carry list machinery nobody uses yet.
  slug       TEXT PRIMARY KEY
               CONSTRAINT game_videos_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),

  -- THE ID, NEVER A URL. The application stores the extracted 11-character id and
  -- builds the embed URL itself, so a pasted `youtube.com/watch?v=…&malicious=…`
  -- cannot smuggle extra query parameters into the iframe `src`.
  --
  -- This CHECK is defence in depth, not the primary guard — `parseYouTubeId()` in
  -- `app/lib/youtube.ts` is what the dashboard validates with. It exists because
  -- this column's value is interpolated into a third-party URL that a browser then
  -- loads, which is precisely the kind of value that should be impossible to get
  -- wrong at the storage layer too.
  youtube_id TEXT NOT NULL
               CONSTRAINT game_videos_youtube_id_format CHECK (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),

  -- What the toggle above the hero media calls this — "Gameplay", "Intro",
  -- "Trailer". Free text rather than an enum because the distinction is editorial
  -- and an admin should not need a migration to call something a "Speedrun".
  label      TEXT NOT NULL DEFAULT 'Gameplay'
               CONSTRAINT game_videos_label_length CHECK (char_length(label) BETWEEN 1 AND 40),

  -- Who attached it. Same rule as `game_credits.uploader_email`: no foreign key to
  -- dashboard_users(email), because removing somebody from the admin allow-list
  -- must not erase the record of what they did. Stored for tracing, NEVER rendered.
  added_by   TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
