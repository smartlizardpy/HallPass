-- HallPass — a game's gameplay/intro video. Canonical fresh-install DDL.
--
-- Kept in lockstep with `app/lib/scoreboard/migrations/013_game_videos.sql`,
-- which is the same body wrapped in BEGIN/COMMIT. Read that file for the full
-- reasoning; the decisions worth repeating here are the ones somebody will be
-- tempted to "improve".

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
