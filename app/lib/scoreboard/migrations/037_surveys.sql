-- HallPass — migration: admin-editable player surveys.
--
-- See `app/lib/surveys/schema.sql` for the canonical fresh-install DDL; keep the
-- two in lockstep.
--
-- WHY THIS EXISTS. The next game release should be steered by what players say,
-- and what to ask changes every release. So the questions are DATA an admin (or
-- an MCP client) edits, not a form compiled into the app.
--
-- FOUR TABLES, NOT ONE JSON BLOB. A survey owns ordered questions; a response is
-- one player's submission; an answer is one response's reply to one question.
-- Answers are rows rather than a jsonb document on the response so "how many
-- picked option b of question 7" is an index lookup, not a scan of every blob.
--
-- QUESTIONS ARE NEVER REWRITTEN ONCE ANSWERED. Changing "Do you like the art?"
-- to "Do you like the sound?" under 400 existing answers would silently turn
-- them into answers to a question nobody asked. So the store edits an
-- unanswered question in place, and for an answered one sets `retired_at` and
-- inserts a replacement. Results keep reading the retired row's own wording.
-- `options` is `[{"id": "o1", "label": "..."}]`: answers store the stable `id`,
-- so renaming a label on an unanswered question cannot re-point old answers.
--
-- ONE RESPONSE PER PLAYER, enforced by `UNIQUE (survey_id, player_id)` so the
-- database refuses the second submit however the race falls. `player_id` is
-- ON DELETE SET NULL: deleting an account must not delete the survey results
-- the release was decided on. (NULLs are distinct in a unique index, so
-- orphaned responses do not collide.)
--
-- ADMIN IDENTITY (`created_by`) IS AN EMAIL STRING, NOT A FOREIGN KEY, like
-- every other admin-authored table here.
--
-- READ THIS BEFORE DEPLOYING THE CODE. Reads are fail-soft, so a deploy that
-- ships before this migration shows no surveys rather than failing; writes
-- throw. Apply it to the database first.
--
-- Fully idempotent — whole file in one transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS surveys (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        TEXT NOT NULL
                CONSTRAINT surveys_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  title       TEXT NOT NULL
                CONSTRAINT surveys_title_length CHECK (length(title) BETWEEN 1 AND 140),
  intro       TEXT NOT NULL DEFAULT ''
                CONSTRAINT surveys_intro_length CHECK (length(intro) <= 2000),
  status      TEXT NOT NULL DEFAULT 'draft'
                CONSTRAINT surveys_status CHECK (status IN ('draft','live','closed')),
  closes_at   TIMESTAMPTZ,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS surveys_slug_idx ON surveys (slug);
CREATE INDEX IF NOT EXISTS surveys_status_idx
  ON surveys (status, id DESC) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS survey_questions (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  survey_id  BIGINT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  kind       TEXT NOT NULL
               CONSTRAINT survey_questions_kind
               CHECK (kind IN ('single','multi','scale','text')),
  prompt     TEXT NOT NULL
               CONSTRAINT survey_questions_prompt_length CHECK (length(prompt) BETWEEN 1 AND 300),
  required   BOOLEAN NOT NULL DEFAULT true,
  options    JSONB NOT NULL DEFAULT '[]'::jsonb
               CONSTRAINT survey_questions_options_array CHECK (jsonb_typeof(options) = 'array'),
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS survey_questions_survey_idx
  ON survey_questions (survey_id, position, id);

CREATE TABLE IF NOT EXISTS survey_responses (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  survey_id  BIGINT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  player_id  TEXT REFERENCES players(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT survey_responses_one_per_player UNIQUE (survey_id, player_id)
);

CREATE TABLE IF NOT EXISTS survey_answers (
  response_id BIGINT NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  choice_ids  TEXT[],
  scale       SMALLINT CONSTRAINT survey_answers_scale_range CHECK (scale BETWEEN 1 AND 5),
  body        TEXT CONSTRAINT survey_answers_body_length CHECK (length(body) BETWEEN 1 AND 2000),
  PRIMARY KEY (response_id, question_id),
  -- Exactly one reply shape per answer; a skipped optional question has no row.
  CONSTRAINT survey_answers_one_shape CHECK (num_nonnulls(choice_ids, scale, body) = 1)
);

CREATE INDEX IF NOT EXISTS survey_answers_question_idx ON survey_answers (question_id);

COMMIT;
