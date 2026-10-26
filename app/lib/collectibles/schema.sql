-- HallPass — collectibles: canonical fresh-install DDL.
--
-- Mirrors migrations/049_collectibles.sql (which carries the reasoning); keep
-- the two in lockstep. Requires `players` (players.sql).

-- One row per GRANTED pack. `public_id` is the only id that goes on the wire.
-- `pack_id` and `pack_version` name a catalogue definition (app/lib/collectibles/
-- catalogue); the grant PINS the version current at grant time and the opening
-- rolls from that version even if a newer one exists. Nothing is rolled at grant
-- time: contents come into being only in the opening, which writes the pulls and
-- sets `opened_at` in one statement.
-- `grant_key` is the idempotency key (callers own the scheme, e.g.
-- 'fright-fest-2026:participation:<player>'): granting twice grants once.
CREATE TABLE IF NOT EXISTS player_packs (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  player_id      TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  pack_id        TEXT NOT NULL
                   CONSTRAINT player_packs_pack_chk CHECK (pack_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  pack_version   INTEGER NOT NULL
                   CONSTRAINT player_packs_version_chk CHECK (pack_version >= 1),
  grant_key      TEXT NOT NULL UNIQUE
                   CONSTRAINT player_packs_grant_key_chk CHECK (char_length(grant_key) BETWEEN 1 AND 200),
  source         TEXT NOT NULL
                   CONSTRAINT player_packs_source_chk CHECK (source IN ('championship','admin','event')),
  source_ref     TEXT CONSTRAINT player_packs_source_ref_chk CHECK (source_ref IS NULL OR char_length(source_ref) <= 200),
  granted_by     TEXT,
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at      TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  revoked_by     TEXT,
  revoked_reason TEXT CONSTRAINT player_packs_revoked_reason_chk CHECK (revoked_reason IS NULL OR char_length(revoked_reason) <= 500),
  -- Only a sealed pack is revoked; an opened pack's cards are corrected one pull at a time.
  CONSTRAINT player_packs_revoke_sealed_chk CHECK (revoked_at IS NULL OR opened_at IS NULL),
  CONSTRAINT player_packs_revoke_who_chk CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
-- The Pack Room: a player's sealed packs, and their openings, newest first.
CREATE INDEX IF NOT EXISTS player_packs_player_idx ON player_packs (player_id, granted_at DESC);

-- The ownership LEDGER, append-only: a pull is never updated except to revoke
-- it. Quantity, duplicates and collection progress are `count(*) ... WHERE
-- revoked_at IS NULL`; there is no counter that can drift. `player_pack_id` +
-- `slot` is UNIQUE, so a pack can never have two sets of pulls, whatever races.
-- `source = 'admin'` is reserved for a card an admin hands over directly (no pack).
CREATE TABLE IF NOT EXISTS collectible_pulls (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id       TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  collectible_id  TEXT NOT NULL
                    CONSTRAINT collectible_pulls_collectible_chk CHECK (collectible_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  player_pack_id  BIGINT REFERENCES player_packs(id) ON DELETE CASCADE,
  slot            SMALLINT CONSTRAINT collectible_pulls_slot_chk CHECK (slot IS NULL OR slot BETWEEN 1 AND 20),
  -- Computed in the opening statement: never owned before AND first of its kind within the pack.
  was_new         BOOLEAN NOT NULL,
  source          TEXT NOT NULL DEFAULT 'pack'
                    CONSTRAINT collectible_pulls_source_chk CHECK (source IN ('pack','admin')),
  pulled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  revoked_by      TEXT,
  revoked_reason  TEXT CONSTRAINT collectible_pulls_revoked_reason_chk CHECK (revoked_reason IS NULL OR char_length(revoked_reason) <= 500),
  CONSTRAINT collectible_pulls_unique_slot UNIQUE (player_pack_id, slot),
  CONSTRAINT collectible_pulls_origin_chk
    CHECK (source = 'admin' OR (player_pack_id IS NOT NULL AND slot IS NOT NULL)),
  CONSTRAINT collectible_pulls_revoke_who_chk CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
-- The binder: what a player owns, by card.
CREATE INDEX IF NOT EXISTS collectible_pulls_owned_idx
  ON collectible_pulls (player_id, collectible_id) WHERE revoked_at IS NULL;

-- Per-card choices a player makes. One row per (player, card), created on first use.
-- `featured_position` (1-6) is unique per player; the constraint is DEFERRABLE so
-- one statement can move a card into a slot and clear the previous holder.
-- `seen_at` clears the NEW dot in the binder.
CREATE TABLE IF NOT EXISTS player_collectible_prefs (
  player_id         TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  collectible_id    TEXT NOT NULL
                      CONSTRAINT player_collectible_prefs_collectible_chk CHECK (collectible_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  favourite         BOOLEAN NOT NULL DEFAULT false,
  featured_position SMALLINT
                      CONSTRAINT player_collectible_prefs_position_chk CHECK (featured_position IS NULL OR featured_position BETWEEN 1 AND 6),
  seen_at           TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, collectible_id),
  CONSTRAINT player_collectible_prefs_position_unique UNIQUE (player_id, featured_position) DEFERRABLE INITIALLY DEFERRED
);

-- Every admin grant, revocation and correction, written in the same statement as
-- the change it records. `actor_email` is the dashboard user, never a form field.
-- The reason is mandatory.
CREATE TABLE IF NOT EXISTS collectibles_log (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_email     TEXT NOT NULL,
  action          TEXT NOT NULL
                    CONSTRAINT collectibles_log_action_chk CHECK (action IN ('grant-pack','revoke-pack','revoke-pull')),
  player_id       TEXT REFERENCES players(id) ON DELETE SET NULL,
  player_pack_id  BIGINT REFERENCES player_packs(id) ON DELETE SET NULL,
  pull_id         BIGINT REFERENCES collectible_pulls(id) ON DELETE SET NULL,
  reason          TEXT NOT NULL CONSTRAINT collectibles_log_reason_chk CHECK (char_length(reason) BETWEEN 1 AND 500),
  data            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collectibles_log_created_idx ON collectibles_log (created_at DESC);
