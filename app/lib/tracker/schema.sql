-- HallPass — the project tracker tables (fresh install).
--
-- The canonical DDL for a database being created from scratch. For an EXISTING
-- database, run the one-time `scoreboard/migrations/021_tracker.sql` instead —
-- the two must stay in lockstep.
--
-- Read that migration's header for the design argument, and `tracker-design.md`
-- for the whole thing. In brief:
--
--   * ONE table, not projects + items. The pasted brief IS the tracked thing;
--     splitting it would force a choice about whether the status lives on the
--     parent or the child, and either answer is wrong half the time. Tags do the
--     grouping, and linked GitHub issues will later be the child level.
--   * TAGS AND STATUS ARE THE WHOLE VOCABULARY. No priority, effort, due date or
--     assignee — one person builds, so the board order already answers "what is
--     next", and each is one additive migration if that stops being true.
--   * `status` is worded for the READER, and `parked`/`declined` stay separate
--     so the board can distinguish "we still want it" from "we already said no".
--   * The audit trail (`tracker_events`) has NO foreign key to the item, exactly
--     like `review_moderation_log`, so history outlives what it describes.
--   * `slug` appears nowhere: this tracker is for SITE features, and game bugs
--     already live in `beta_reports`.

CREATE TABLE IF NOT EXISTS tracker_items (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title        TEXT NOT NULL
                 CONSTRAINT tracker_items_title_length CHECK (length(title) BETWEEN 1 AND 140),
  -- The pasted detail; 20 000 chars so a whole spec or chat log fits. Rendered
  -- `whitespace-pre-wrap`, never `dangerouslySetInnerHTML`.
  brief        TEXT NOT NULL DEFAULT ''
                 CONSTRAINT tracker_items_brief_length CHECK (length(brief) <= 20000),
  status       TEXT NOT NULL DEFAULT 'new'
                 CONSTRAINT tracker_items_status
                 CHECK (status IN ('new','planned','building','shipped','parked','declined')),
  position     INTEGER NOT NULL DEFAULT 0,
  -- `dashboard_users.email`, deliberately not a foreign key.
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  done_at      TIMESTAMPTZ,
  archived_at  TIMESTAMPTZ,

  -- GitHub seam: nullable, unused for now, here so linking issues later is not a
  -- migration. Which side owns status is deliberately undecided.
  gh_repo         TEXT,
  gh_issue_number INTEGER,
  gh_synced_at    TIMESTAMPTZ,

  -- The database keeps `status` and `done_at` agreeing, so leaving a terminal
  -- status has to clear the stamp.
  CONSTRAINT tracker_items_done_at_matches_status
    CHECK ((status IN ('shipped','declined')) = (done_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS tracker_items_board_idx
  ON tracker_items (status, position, id DESC) WHERE archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tracker_items_gh_idx
  ON tracker_items (gh_repo, gh_issue_number) WHERE gh_issue_number IS NOT NULL;

-- A join table rather than a `TEXT[]`, so a tag filter is an index lookup. No
-- registry table: the tag list is `SELECT DISTINCT tag`, which cannot drift from
-- the tags actually in use.
CREATE TABLE IF NOT EXISTS tracker_item_tags (
  item_id BIGINT NOT NULL REFERENCES tracker_items(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL
            CONSTRAINT tracker_item_tags_format CHECK (tag ~ '^[a-z0-9][a-z0-9-]{0,23}$'),
  PRIMARY KEY (item_id, tag)
);

CREATE INDEX IF NOT EXISTS tracker_item_tags_tag_idx ON tracker_item_tags (tag, item_id);

-- Dated progress notes. Separate from `brief` because the brief gets rewritten
-- and a note must not vanish with it.
CREATE TABLE IF NOT EXISTS tracker_updates (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id      BIGINT NOT NULL REFERENCES tracker_items(id) ON DELETE CASCADE,
  author_email TEXT NOT NULL,
  body         TEXT NOT NULL
                 CONSTRAINT tracker_updates_body_length CHECK (length(body) BETWEEN 1 AND 4000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tracker_updates_item_idx ON tracker_updates (item_id, id DESC);

-- Auto-written activity. `item_id` has NO foreign key on purpose.
CREATE TABLE IF NOT EXISTS tracker_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id     BIGINT,
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL
                CONSTRAINT tracker_events_action
                CHECK (action IN ('create','status','edit','tag','untag',
                                  'archive','restore','comment','link','unlink','delete')),
  from_value  TEXT,
  to_value    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tracker_events_item_idx ON tracker_events (item_id, id DESC);
CREATE INDEX IF NOT EXISTS tracker_events_recent_idx ON tracker_events (created_at DESC);
