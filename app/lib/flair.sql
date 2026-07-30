-- HallPass — admin-granted player flair for a FRESH database.
--
-- One row per grant: a short, admin-authored title an admin confers on a player
-- from the dashboard ("Beta Tester", "Founder", "Staff"). It renders as a pill on
-- the player's public profile.
--
-- `player_flair` references `players(id)`, so `app/lib/players.sql` must be
-- applied first.
--
-- For an EXISTING database, run `scoreboard/migrations/014_player_flair.sql`
-- instead — it is this same body wrapped in a transaction. The two must be kept
-- in lockstep, exactly as `social.sql` is with `007_social_graph.sql`.
--
-- WHY THIS EXISTS ALONGSIDE `badges.ts` AND `achievements`. Both of those answer
-- "what has this player accomplished": badges are DERIVED from platform rows and
-- achievements are EARNED and reported by a game. A flair answers a different
-- question — "what has an admin decided to say about this player" — which is
-- neither derivable nor earned. It is an editorial act, so it is stored and it
-- records who made it.

CREATE TABLE IF NOT EXISTS player_flair (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- CASCADE, like `player_favorites` and `player_achievements`: a flair belongs
  -- to nobody once its owner's account is gone, so it is cleaned up rather than
  -- left to resurrect if the Google subject id is reused on re-signup.
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,

  -- Admin-authored: the app sanitises control/bidi/zero-width characters before
  -- insert (see `app/lib/flair.ts`), so only a length bound lives here.
  label       TEXT NOT NULL
                CONSTRAINT player_flair_label_length CHECK (char_length(label) BETWEEN 1 AND 24),

  -- Optional single emoji, mirroring `achievements.icon`.
  icon        TEXT
                CONSTRAINT player_flair_icon_length CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 8),

  -- Colour bucket, whitelisted here AND in `FLAIR_TONES` in `app/lib/flair.ts`.
  tone        TEXT NOT NULL DEFAULT 'brand'
                CONSTRAINT player_flair_tone_check
                  CHECK (tone IN ('brand', 'gold', 'green', 'blue', 'pink', 'gray')),

  -- The acting admin's email — an audit trail, not a foreign key.
  granted_by  TEXT NOT NULL,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One label per player: re-granting the same title is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS player_flair_player_label_idx
  ON player_flair (player_id, label);

-- The profile read — every flair for one player, newest first.
CREATE INDEX IF NOT EXISTS player_flair_player_idx
  ON player_flair (player_id, created_at DESC);
