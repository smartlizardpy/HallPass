-- HallPass — migration: admin-granted player flair ("custom perks").
--
-- See `app/lib/flair.sql` for the canonical fresh-install DDL and the full
-- reasoning; the two must be kept in lockstep, exactly as `social.sql` is with
-- `007_social_graph.sql` and `achievements.sql` is with `009_achievements.sql`.
--
-- WHAT THIS IS. A flair is a short, admin-authored title an admin GRANTS to one
-- player from the dashboard — "Beta Tester", "Founder", "Staff". Unlike
-- `badges.ts` (derived from platform rows) and unlike `achievements` (reported by
-- a game and earned), a flair is not earned and not derivable: it is a deliberate
-- editorial act, so it is written down and carries who granted it.
--
-- SELF-CONTAINED GRANT: the row IS the definition. There is no separate flair
-- catalogue because there is nothing to reuse across players that an admin
-- retyping a six-character label does not cover, and a catalogue would need its
-- own CRUD surface, its own foreign key, and a "what happens to grants when the
-- definition is deleted" answer — all cost for a feature whose whole point is
-- that it is ad hoc.
--
-- Fully idempotent — every statement guarded, whole file in one transaction —
-- following `009_achievements.sql` rather than the "RUN ONCE" migrations.

BEGIN;

CREATE TABLE IF NOT EXISTS player_flair (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- CASCADE, like `player_favorites` and `player_achievements`, and deliberately
  -- UNLIKE `player_blocks` (which has no FK on purpose). A block must outlive the
  -- blocked party's account churn; a flair is cosmetic and belongs to nobody once
  -- its owner is gone, so an orphan is just litter that would resurrect if the
  -- Google subject id were reused on re-signup.
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,

  -- Admin-authored, so no charset gate here (the app sanitises control/bidi/
  -- zero-width characters before insert — see `app/lib/flair.ts`); only a length
  -- bound, matching the short-pill scale of a badge label.
  label       TEXT NOT NULL
                CONSTRAINT player_flair_label_length CHECK (char_length(label) BETWEEN 1 AND 24),

  -- Optional single emoji, mirroring `achievements.icon`. NULL renders a
  -- text-only pill rather than a placeholder glyph.
  icon        TEXT
                CONSTRAINT player_flair_icon_length CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 8),

  -- Colour bucket for the pill. Whitelisted here AND in `FLAIR_TONES` in
  -- `app/lib/flair.ts`; kept in lockstep by hand, the same arrangement as the
  -- achievement key format. An unknown value can only arrive from a hand-edit.
  tone        TEXT NOT NULL DEFAULT 'brand'
                CONSTRAINT player_flair_tone_check
                  CHECK (tone IN ('brand', 'gold', 'green', 'blue', 'pink', 'gray')),

  -- The acting admin's email, an audit trail exactly like `dashboard_users.
  -- invited_by`. Not a foreign key: an admin can be de-listed while the grants
  -- they made stand.
  granted_by  TEXT NOT NULL,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One label per player: re-granting the same title is a no-op, not a stack of
-- identical pills. This is the ON CONFLICT target the grant path relies on.
CREATE UNIQUE INDEX IF NOT EXISTS player_flair_player_label_idx
  ON player_flair (player_id, label);

-- The profile read — every flair for one player, newest first.
CREATE INDEX IF NOT EXISTS player_flair_player_idx
  ON player_flair (player_id, created_at DESC);

COMMIT;
