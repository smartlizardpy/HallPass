-- HallPass — the survey tables (fresh install).
--
-- The canonical DDL for a database being created from scratch. For an EXISTING
-- database, run the one-time `scoreboard/migrations/037_surveys.sql` instead —
-- the two must stay in lockstep. That migration's header holds the design
-- argument (why answered questions are retired rather than rewritten, why
-- `player_id` is ON DELETE SET NULL, why answers are rows and not a blob).

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
  CONSTRAINT survey_answers_one_shape CHECK (num_nonnulls(choice_ids, scale, body) = 1)
);

CREATE INDEX IF NOT EXISTS survey_answers_question_idx ON survey_answers (question_id);
