-- HallPass — migration: game invites (`HallPass.invite()` and `/i/<code>`).
--
-- See `app/lib/invites/schema.sql` for the canonical fresh-install DDL; keep the
-- two in lockstep. `docs/invites-design.md` has the whole argument.
--
-- ONE ROW PER INVITE.
--   * kind 'friend' — one row PER RECIPIENT, so each has its own code, its own
--     notification and its own dedupe key. `from_player` and `to_player` are set.
--   * kind 'link'   — one row with NO recipient, for the "Share link" button.
--     `from_player` is NULL when a guest made it; `sender_key` then carries a
--     SALTED hash of the guest's IP for rate limiting (never the address).
--
-- `data` is the game's own payload (LAST BELL: `{ "room": "ABCD" }`). HallPass
-- never interprets it; the route bounds it to a JSON object of at most 1 KB.
--
-- `code` is 12 characters of the friend-code alphabet (no confusables, no
-- vowels). It is the only key a stranger ever holds, so it is UNIQUE and the
-- lookup index.
--
-- EVERYTHING HERE IS SHORT-LIVED. An invite lives 1–120 minutes. There is no
-- cron: every write deletes rows that expired more than an hour ago, through
-- `game_invites_expires_idx`. The hour of grace keeps the hourly rate limits
-- honest, because they count rows.
--
-- `ON DELETE CASCADE` on both players: an account deleted takes its invites with
-- it, sent and received.
--
-- Fully idempotent — whole file in one transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS game_invites (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        TEXT        NOT NULL UNIQUE
                          CHECK (code ~ '^[0-9CDFGHJKMNPQRTVWXY]{12}$'),
  slug        TEXT        NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  kind        TEXT        NOT NULL CHECK (kind IN ('friend', 'link')),
  data        JSONB       NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  from_player TEXT        REFERENCES players(id) ON DELETE CASCADE,
  to_player   TEXT        REFERENCES players(id) ON DELETE CASCADE,
  sender_key  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  -- A friend invite names both people; a link names no recipient.
  CONSTRAINT game_invites_friend_shape_chk
    CHECK (kind <> 'friend' OR (from_player IS NOT NULL AND to_player IS NOT NULL)),
  CONSTRAINT game_invites_link_shape_chk
    CHECK (kind <> 'link' OR to_player IS NULL),
  -- Every row is attributable to SOMEBODY for rate limiting.
  CONSTRAINT game_invites_sender_chk
    CHECK (from_player IS NOT NULL OR sender_key IS NOT NULL),
  CONSTRAINT game_invites_expiry_chk CHECK (expires_at > created_at)
);

-- Garbage collection: rows expired more than an hour ago.
CREATE INDEX IF NOT EXISTS game_invites_expires_idx ON game_invites (expires_at);

-- Sender limits (per kind, per window) and the per-pair cooldown, which scans
-- one sender's last ten minutes.
CREATE INDEX IF NOT EXISTS game_invites_sender_idx
  ON game_invites (from_player, kind, created_at)
  WHERE from_player IS NOT NULL;

-- The guest link limit.
CREATE INDEX IF NOT EXISTS game_invites_guest_idx
  ON game_invites (sender_key, created_at)
  WHERE sender_key IS NOT NULL;

COMMIT;
