CREATE TABLE IF NOT EXISTS boards (
  slug         TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  sort         TEXT NOT NULL DEFAULT 'desc' CHECK (sort IN ('desc','asc')),
  score_label  TEXT NOT NULL DEFAULT 'Score',
  max_score    BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        TEXT NOT NULL REFERENCES boards(slug) ON DELETE CASCADE,
  handle      TEXT NOT NULL,
  score       BIGINT NOT NULL,
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scores_slug_desc ON scores (slug, score DESC, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_scores_slug_asc  ON scores (slug, score ASC, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_scores_slug_created ON scores (slug, created_at DESC);
