-- HallPass — migration: the notification inbox and its preferences.
--
-- See `app/lib/notifications/schema.sql` for the canonical fresh-install DDL and
-- `notifications-design.md` for the full argument; keep all three in lockstep.
--
-- WHAT. Migration 023 shipped a complete Web Push TRANSPORT and no product layer:
-- a push was fired and forgotten, so miss the banner and the event was gone. This
-- adds the three pieces that were missing — what happened, how far you have read,
-- and what you want to be told about.
--
-- WHY `player_id` IS NULLABLE. It is the discriminator, in the same spirit as
-- `kind` in 022:
--
--     player_id | meaning
--     ----------+------------------------------------------------------------
--     set       | personal — this happened TO YOU
--     NULL      | site-wide broadcast — this happened, and it is for everyone
--
-- A game drop is aimed at the whole site. The obvious alternative — fan out one
-- row per player — writes O(players) rows for a single event, and with no cron to
-- prune with that cost is paid permanently, for every account ever registered
-- including the ones that never came back. One row plus a read-time union is O(1)
-- to write and cannot grow that way. The honest cost is that a broadcast cannot
-- carry per-player state, which is exactly what decides `notification_state`.
--
-- WHY THERE IS NO `read_at` COLUMN, AND A WATERMARK INSTEAD. A broadcast is one
-- shared row and physically CANNOT carry a per-player `read_at` without the
-- fan-out table just rejected. So the read model has to work by timestamp for
-- broadcasts no matter what — and giving personal rows a SECOND, different
-- mechanism buys inconsistency rather than capability. One rule covers both:
-- unread means created after your mark in `notification_state`.
--
-- What that costs, stated plainly: you cannot keep one notification unread while
-- dismissing its neighbours. Opening the bell clears the badge for everything.
-- That is what the bells people already use do, and the per-item "new" dot still
-- renders from `created_at > seen_at`. A `read_at` column can be added later for
-- personal rows without changing what the watermark means.
--
-- WHY `dedupe_key` IS PARTIALLY UNIQUE. It is how a producer says "this event has
-- an identity". Marking a game New, un-marking it and marking it again is ONE
-- drop, not three, because the key is `game_drop:<slug>` and the insert is
-- ON CONFLICT DO NOTHING. Producers with no natural identity leave it NULL, and
-- the PARTIAL index ignores those — so "no key" means "never deduped" rather than
-- "collides with every other keyless row", which is what a plain UNIQUE would
-- have meant (NULLs are distinct in Postgres, so a plain UNIQUE would happen to
-- work today — the partial index says the intent out loud and keeps the index off
-- every keyless row).
--
-- WHY `notification_prefs` IS SPARSE. A row exists only where a player has
-- DEVIATED from a kind's default. The alternative is materialising every kind for
-- every player, which means a backfill every time a kind is added and a schema
-- where "has no opinion" is indistinguishable from "predates this kind". Defaults
-- live in `app/lib/notifications/config.ts`, so a new kind is live for everybody
-- the moment it deploys, with no migration.
--
-- WHY KINDS ARE NOT CHECK-CONSTRAINED HERE, unlike `challenges.kind` in 022.
-- There the enum was two members with per-kind CHECKs enforcing the SHAPE of the
-- row — the constraint was doing real work. Here every kind produces an
-- identically shaped row and the catalogue is expected to grow whenever a
-- producer is written. A CHECK would mean a migration per kind for no integrity
-- gained, and an unknown kind already degrades safely: `config.ts` is the only
-- thing that can render one, and it filters what it does not recognise.
--
-- RETENTION WITHOUT A SWEEPER. There is no cron (`007_social_graph.sql` says so).
-- Both inserts cap themselves IN THE SAME STATEMENT that writes them — the same
-- device-cap CTE `push_subscriptions` uses — so the table is bounded by
-- players x cap + broadcast cap by construction. See `notifications/store.ts`.
--
-- Fully idempotent — every statement guarded, whole file in one transaction —
-- following `023_push_subscriptions.sql`.

BEGIN;

CREATE TABLE IF NOT EXISTS notifications (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- NULL = site-wide broadcast. See the header.
  player_id    TEXT REFERENCES players(id) ON DELETE CASCADE,

  -- Which catalogue entry this is. Free TEXT on purpose — see the header.
  kind         TEXT NOT NULL,

  -- The rendered copy, stored rather than recomputed. A notification is a record
  -- of what somebody was told, and re-deriving it later from live data would
  -- silently rewrite history: rename a game and last month's drop announcement
  -- would start naming the new title.
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,

  -- Where a tap lands. Always an app-relative path; nothing here builds absolute
  -- URLs, and the bell refuses to render one that is not relative.
  url          TEXT NOT NULL,

  -- Optional producer-supplied identity. NULL = never deduped.
  dedupe_key   TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The bell's read: "my rows plus every broadcast, newest first".
CREATE INDEX IF NOT EXISTS notifications_player_idx
  ON notifications (player_id, created_at DESC);

-- Broadcasts are read by EVERY signed-in player on every bell poll, and the
-- index above cannot serve them: `player_id IS NULL` is one value out of many, so
-- a query for it would scan the whole leading column. A partial index over just
-- the broadcast rows is small and exactly the shape of that read.
CREATE INDEX IF NOT EXISTS notifications_broadcast_idx
  ON notifications (created_at DESC)
  WHERE player_id IS NULL;

-- Identity, where a producer supplies one. Partial, so keyless rows are not
-- indexed at all.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- How far each player has read. One row per player, created on first mark.
CREATE TABLE IF NOT EXISTS notification_state (
  player_id  TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  -- Everything created after this is unread. A player with no row here has read
  -- nothing, which is the correct starting point: their first bell shows what is
  -- waiting rather than an inbox that silently marked itself read.
  seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deviations from the per-kind defaults. Sparse — see the header.
CREATE TABLE IF NOT EXISTS notification_prefs (
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,

  -- CHECKED, unlike `kind`: these three ARE the model, they are read by the
  -- delivery path to decide whether to touch the push transport at all, and an
  -- unrecognised value here would be a silent misdelivery rather than a row the
  -- UI declines to render. `push` implies `bell` — there is deliberately no
  -- "push but not inbox", which would be a message you cannot re-read.
  channel    TEXT NOT NULL CHECK (channel IN ('off', 'bell', 'push')),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (player_id, kind)
);

COMMIT;
