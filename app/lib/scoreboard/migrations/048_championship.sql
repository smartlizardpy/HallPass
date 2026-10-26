-- HallPass — migration: the championship (Fright Fest 2026 and later events).
--
-- See `app/lib/championship/schema.sql` for the canonical fresh-install DDL;
-- keep the two in lockstep. `docs/championship-design.md` has the argument.
--
-- Separate from `scores` on purpose: a ranked run needs a server-issued token,
-- a verification state, review metadata and an audit trail, and ordinary boards
-- need none of that. Nothing here touches `scores` or `boards`.
--
-- Fully idempotent — whole file in one transaction.

BEGIN;

-- One row per championship. The DATES live in code (app/lib/championship/
-- fright-fest-2026.ts); this row holds only what an admin changes at run time.
-- `status` moves scheduled → verification → finalised → archived and never back;
-- `suspended` is an independent emergency brake that refuses every run without
-- touching any other state.
CREATE TABLE IF NOT EXISTS championship_events (
  id               TEXT PRIMARY KEY
                     CONSTRAINT championship_events_id_chk CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  status           TEXT NOT NULL DEFAULT 'scheduled'
                     CONSTRAINT championship_events_status_chk
                     CHECK (status IN ('scheduled','verification','finalised','archived')),
  suspended        BOOLEAN NOT NULL DEFAULT false,
  suspended_reason TEXT,
  -- Set when an admin closes submissions before the configured close.
  closed_early_at  TIMESTAMPTZ,
  -- The frozen result written once at finalisation: public ids, ranks and points,
  -- never names (resolved at read time, so a deleted account reads "Former player").
  final_standings  JSONB,
  finalised_at     TIMESTAMPTZ,
  finalised_by     TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT championship_events_final_chk
    CHECK (status NOT IN ('finalised','archived') OR (final_standings IS NOT NULL AND finalised_at IS NOT NULL))
);

-- The lineup, per game. `pending` until an admin verifies the game's event mode
-- and opens its board; a board counts from `opened_at`. `withdrawn` removes a
-- board from Fright Points (with a reason in the log).
CREATE TABLE IF NOT EXISTS championship_games (
  event_id      TEXT NOT NULL REFERENCES championship_events(id) ON DELETE CASCADE,
  game_slug     TEXT NOT NULL
                  CONSTRAINT championship_games_slug_chk CHECK (game_slug ~ '^[a-z0-9][a-z0-9-]*$'),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CONSTRAINT championship_games_status_chk
                  CHECK (status IN ('pending','open','paused','withdrawn')),
  opened_at     TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, game_slug),
  CONSTRAINT championship_games_opened_chk CHECK (status NOT IN ('open','paused') OR opened_at IS NOT NULL)
);

-- One row per RUN TOKEN. Issued (server clock) when a run starts, completed by
-- exactly one submission, never deleted: rejected and disqualified runs are the
-- audit trail. Only the SHA-256 of the token is stored. `checks` is the server's
-- own evidence (elapsed time and the like) and `meta` is what the game claimed;
-- both are shown to reviewers. Cascades with the player's account, like every
-- other per-player table.
CREATE TABLE IF NOT EXISTS championship_runs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      TEXT NOT NULL,
  game_slug     TEXT NOT NULL,
  player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE
                  CONSTRAINT championship_runs_token_chk CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  seed          BIGINT,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  submitted_at  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'issued'
                  CONSTRAINT championship_runs_status_chk
                  CHECK (status IN ('issued','accepted','flagged','rejected','disqualified')),
  score         BIGINT,
  tiebreak      DOUBLE PRECISION,
  meta          JSONB,
  checks        JSONB,
  flags         TEXT[] NOT NULL DEFAULT '{}',
  reason        TEXT,
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  FOREIGN KEY (event_id, game_slug) REFERENCES championship_games(event_id, game_slug) ON DELETE CASCADE,
  CONSTRAINT championship_runs_submitted_chk CHECK (status = 'issued' OR submitted_at IS NOT NULL),
  CONSTRAINT championship_runs_scored_chk
    CHECK (status NOT IN ('accepted','flagged','disqualified') OR score IS NOT NULL)
);

-- Standings: accepted runs per board.
CREATE INDEX IF NOT EXISTS championship_runs_board_idx
  ON championship_runs (event_id, game_slug, score) WHERE status = 'accepted';
-- A player's runs (rate limits, "my progress").
CREATE INDEX IF NOT EXISTS championship_runs_player_idx
  ON championship_runs (player_id, event_id, issued_at DESC);
-- The admin list, newest submission first, by status.
CREATE INDEX IF NOT EXISTS championship_runs_review_idx
  ON championship_runs (event_id, status, submitted_at DESC) WHERE status <> 'issued';

-- Every admin action, written in the same statement as the change it records.
-- `actor_email` is the dashboard user from requireRole(), never a form field.
CREATE TABLE IF NOT EXISTS championship_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES championship_events(id) ON DELETE CASCADE,
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL
                CONSTRAINT championship_log_action_chk
                CHECK (action IN (
                  'open-game','pause-game','resume-game','withdraw-game',
                  'suspend','resume','close-early','reopen',
                  'start-verification','finalise','grant-rewards','archive',
                  'approve-run','disqualify-run','reinstate-run'
                )),
  run_id      BIGINT REFERENCES championship_runs(id) ON DELETE SET NULL,
  game_slug   TEXT,
  player_id   TEXT REFERENCES players(id) ON DELETE SET NULL,
  reason      TEXT CONSTRAINT championship_log_reason_chk CHECK (reason IS NULL OR char_length(reason) <= 500),
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS championship_log_event_idx ON championship_log (event_id, created_at DESC);

-- Fright Fest 2026: Last Bell opens with the event; the other two wait for
-- verification (docs/championship-design.md §1).
INSERT INTO championship_events (id) VALUES ('fright-fest-2026') ON CONFLICT (id) DO NOTHING;
INSERT INTO championship_games (event_id, game_slug, status, opened_at) VALUES
  ('fright-fest-2026', 'last-bell', 'open', '2026-10-28T00:00:00Z'),
  ('fright-fest-2026', 'shadow-core-halloween-dash', 'pending', NULL),
  ('fright-fest-2026', 'survive-till-dawn-pixel-edition', 'pending', NULL)
ON CONFLICT (event_id, game_slug) DO NOTHING;

COMMIT;
