-- HallPass — Candy Hunt: canonical fresh-install DDL.
--
-- Mirrors migrations/050_candy.sql (which carries the reasoning); keep the two
-- in lockstep. Requires `players` (players.sql), `player_packs`
-- (collectibles/schema.sql) and `achievements` (achievements.sql, which carries
-- the `candy` column on a fresh install).

-- THE LEDGER, append-only. One row per credit or spend; a balance is
-- `sum(amount) WHERE revoked_at IS NULL`, so there is no counter that can drift.
-- Credits are > 0, spends < 0. `award_key` is the idempotency key, unique across
-- the table: syncing twice, or a double-tapped spend, hits ON CONFLICT and writes
-- nothing. Keys look like 'candy:fright-fest-2026:<kind>:<playerId>:<ref>'.
-- A credit is never deleted: a wrong one is REVOKED (it stops counting), with a
-- reason, by an admin or by the sync (`revoked_by = 'system'`, for a ranked-run
-- credit whose board no longer has an accepted run for the player). A spend is
-- never revoked. Changing an achievement's candy value never touches old rows.
CREATE TABLE IF NOT EXISTS candy_ledger (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id      TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  event_id       TEXT NOT NULL
                   CONSTRAINT candy_ledger_event_chk CHECK (event_id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  amount         INTEGER NOT NULL
                   CONSTRAINT candy_ledger_amount_chk CHECK (amount BETWEEN -1000 AND 1000 AND amount <> 0),
  kind           TEXT NOT NULL
                   CONSTRAINT candy_ledger_kind_chk CHECK (kind IN ('achievement','ranked_run','all_boards','placing','spend')),
  award_key      TEXT NOT NULL UNIQUE
                   CONSTRAINT candy_ledger_award_key_chk CHECK (char_length(award_key) BETWEEN 1 AND 300),
  -- What it was for: 'slug/key' (achievement), board slug, or pack id (spend).
  ref            TEXT CONSTRAINT candy_ledger_ref_chk CHECK (ref IS NULL OR char_length(ref) <= 200),
  -- The sealed pack a spend bought (the debit and the grant are one transaction).
  player_pack_id BIGINT REFERENCES player_packs(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,
  revoked_by     TEXT,
  revoked_reason TEXT CONSTRAINT candy_ledger_revoked_reason_chk CHECK (revoked_reason IS NULL OR char_length(revoked_reason) <= 500),
  CONSTRAINT candy_ledger_sign_chk CHECK ((kind = 'spend') = (amount < 0)),
  CONSTRAINT candy_ledger_spend_pack_chk CHECK (player_pack_id IS NULL OR kind = 'spend'),
  CONSTRAINT candy_ledger_spend_final_chk CHECK (kind <> 'spend' OR revoked_at IS NULL),
  CONSTRAINT candy_ledger_revoke_who_chk CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
-- A player's balance and history.
CREATE INDEX IF NOT EXISTS candy_ledger_player_idx ON candy_ledger (player_id, event_id, created_at DESC);
-- The admin's recent-activity feed.
CREATE INDEX IF NOT EXISTS candy_ledger_created_idx ON candy_ledger (created_at DESC);

-- Every admin change (an achievement's candy value, a revoked credit), written in
-- the same statement as the change it records. `actor_email` is the dashboard
-- user, never a form field. A revocation always carries a reason.
CREATE TABLE IF NOT EXISTS candy_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL
                CONSTRAINT candy_log_action_chk CHECK (action IN ('set-value','revoke-credit')),
  player_id   TEXT REFERENCES players(id) ON DELETE SET NULL,
  ledger_id   BIGINT REFERENCES candy_ledger(id) ON DELETE SET NULL,
  reason      TEXT CONSTRAINT candy_log_reason_chk CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candy_log_created_idx ON candy_log (created_at DESC);
