-- HallPass — migration: the project tracker.
--
-- See `app/lib/tracker/schema.sql` for the canonical fresh-install DDL and
-- `tracker-design.md` for the full argument; keep all three in lockstep.
--
-- WHY. Work on this site is agreed in chat and remembered by one person. There
-- is no place to paste "here is what I want built", no way for the other admin
-- to see what is being built right now, and no record six months later of why
-- something was dropped. This is that place: an admin pastes a brief, tags it,
-- and reads the status back.
--
-- WHY ONE TABLE AND NOT projects + items. The pasted brief IS the tracked thing.
-- A parent/child split would force a choice about whether the status lives on
-- the parent or the child, and either answer is wrong half the time — a project
-- whose children are half shipped has no honest single status. Tags do the
-- grouping instead, and when GitHub issues are connected later THEY become the
-- child level, which is the level that actually wants one (see the `gh_*`
-- columns below).
--
-- WHY THERE IS NO priority/effort/due_on/assignee. One person builds; the board
-- order answers "what is next" on its own. A priority column on a two-person
-- board converges on everything being marked high, which is the same as no
-- column at all but with a migration behind it. Each is one additive migration
-- if the board ever proves otherwise.
--
-- WHY `slug` DOES NOT APPEAR. This tracker is for SITE features. Game-specific
-- bugs already have `beta_reports`, and giving the same bug two competing
-- statuses in two tables is how both become untrustworthy.
--
-- ON DELETE BEHAVIOUR IS SPLIT DELIBERATELY:
--   * `tracker_item_tags` and `tracker_updates` CASCADE — a tag or a progress
--     note is meaningless without the item it hangs on.
--   * `tracker_events.item_id` has NO FOREIGN KEY AT ALL, exactly like
--     `review_moderation_log.review_id`. The audit trail has to survive the
--     thing it describes; a CASCADE would erase precisely the history you want
--     after someone hard-deletes something contentious.
--
-- Fully idempotent — every statement guarded, whole file in one transaction —
-- following `004_player_favorites.sql` rather than the "RUN ONCE" migrations.

BEGIN;

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tracker_items (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title        TEXT NOT NULL
                 CONSTRAINT tracker_items_title_length CHECK (length(title) BETWEEN 1 AND 140),
  -- The pasted detail. 20 000 characters is deliberate and generous: "paste in
  -- the details" means somebody will drop a whole spec, a chat log or a bullet
  -- list in here, and hitting a limit at that exact moment is how a tool stops
  -- being used. Rendered `whitespace-pre-wrap`, NEVER `dangerouslySetInnerHTML`
  -- — the rule the moderation page states for review bodies holds for every
  -- free-text field on the dashboard.
  brief        TEXT NOT NULL DEFAULT ''
                 CONSTRAINT tracker_items_brief_length CHECK (length(brief) <= 20000),
  -- Worded for the person READING the board, not the person building:
  --   new       pasted in, not yet looked at
  --   planned   agreed and queued
  --   building  being built right now  <- the question the board exists to answer
  --   shipped   live on the site
  --   parked    not now, still wanted
  --   declined  not doing this
  -- `parked` and `declined` stay separate: collapsing them destroys the one
  -- answer this board exists to give — "we still want it" versus "we already
  -- said no" — and without it the same request gets pasted in again every few
  -- months.
  status       TEXT NOT NULL DEFAULT 'new'
                 CONSTRAINT tracker_items_status
                 CHECK (status IN ('new','planned','building','shipped','parked','declined')),
  -- Manual ordering within a lane. Unused by the first UI (which sorts by
  -- recency) and present from the start so adding the arrows later is not a
  -- migration.
  position     INTEGER NOT NULL DEFAULT 0,
  -- `dashboard_users.email` of whoever pasted it in. NOT a foreign key, for the
  -- same reason `review_moderation_log.actor_email` is not: removing somebody
  -- from the admin allow-list must not blank out who asked for what.
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  done_at      TIMESTAMPTZ,
  -- Soft delete. The board filters on it; nothing in the UI hard-deletes.
  archived_at  TIMESTAMPTZ,

  -- GitHub seam. Nullable and entirely unused for now — they ship early so that
  -- connecting issues later is a feature, not a migration. The hard part of that
  -- integration is deciding WHICH SIDE OWNS STATUS, and that choice is
  -- deliberately deferred to when it is built (see `tracker-design.md` §6).
  gh_repo         TEXT,
  gh_issue_number INTEGER,
  gh_synced_at    TIMESTAMPTZ,

  -- The database, not the application, is what keeps `status` and `done_at`
  -- agreeing. Moving an item back out of `shipped` MUST clear the stamp; without
  -- this constraint the store can leave a row that claims to be `planned` and to
  -- have shipped in March, and nothing ever notices.
  CONSTRAINT tracker_items_done_at_matches_status
    CHECK ((status IN ('shipped','declined')) = (done_at IS NOT NULL))
);

-- The board read: every lane, in order, in one query. Partial because every
-- board read filters archived items out and the archive only ever grows.
CREATE INDEX IF NOT EXISTS tracker_items_board_idx
  ON tracker_items (status, position, id DESC) WHERE archived_at IS NULL;

-- One issue maps to at most one item, so a future sync cannot create duplicates
-- by running twice. Partial: NULL `gh_issue_number` is the overwhelming majority
-- and Postgres would treat those NULLs as distinct anyway.
CREATE UNIQUE INDEX IF NOT EXISTS tracker_items_gh_idx
  ON tracker_items (gh_repo, gh_issue_number) WHERE gh_issue_number IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------
--
-- A join table rather than a `TEXT[]` column, so "everything tagged pwa" is an
-- index lookup instead of a scan with an array operator.
--
-- There is deliberately NO `tracker_tags` registry table. The tag list for the
-- filter bar is `SELECT DISTINCT tag`, which at this size is one cheap
-- index-only scan and — unlike a registry — cannot drift from the tags actually
-- in use.
CREATE TABLE IF NOT EXISTS tracker_item_tags (
  item_id BIGINT NOT NULL REFERENCES tracker_items(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL
            CONSTRAINT tracker_item_tags_format CHECK (tag ~ '^[a-z0-9][a-z0-9-]{0,23}$'),
  PRIMARY KEY (item_id, tag)
);

-- Backs both the tag filter and the DISTINCT scan above.
CREATE INDEX IF NOT EXISTS tracker_item_tags_tag_idx ON tracker_item_tags (tag, item_id);

-- ---------------------------------------------------------------------------
-- Updates
-- ---------------------------------------------------------------------------
--
-- The progress narrative, and the reason this board is worth opening: a status
-- chip alone tells a reader nothing about where a thing actually is.
--
-- Deliberately SEPARATE from `tracker_items.brief`, because the two are
-- different kinds of text. The brief is the current ask and gets rewritten; an
-- update is a dated note that does not. Losing "tried X, it does not work
-- because Y" to a brief rewrite is exactly the failure this table prevents.
CREATE TABLE IF NOT EXISTS tracker_updates (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id      BIGINT NOT NULL REFERENCES tracker_items(id) ON DELETE CASCADE,
  author_email TEXT NOT NULL,
  body         TEXT NOT NULL
                 CONSTRAINT tracker_updates_body_length CHECK (length(body) BETWEEN 1 AND 4000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at    TIMESTAMPTZ
);

-- The thread, newest first. Ordered by `id` alone: it is GENERATED ALWAYS AS
-- IDENTITY and therefore already insertion-ordered, so one comparison column is
-- enough (the same argument `game_reviews_public_idx` makes).
CREATE INDEX IF NOT EXISTS tracker_updates_item_idx ON tracker_updates (item_id, id DESC);

-- ---------------------------------------------------------------------------
-- Activity
-- ---------------------------------------------------------------------------
--
-- Auto-written; nothing here is typed by a human. `item_id` is a plain BIGINT
-- with NO foreign key — see the header. The trail outlives the item.
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

COMMIT;
