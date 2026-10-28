-- HallPass — migration: Fright Fest friend referrals.
--
-- See `app/lib/referrals/schema.sql` for the canonical fresh-install DDL and
-- `docs/referrals-design.md` for the rules; keep the two in lockstep.
--
-- DEPENDS ON 050_candy.sql (`candy_ledger`): a rewarded referral IS a candy-ledger
-- credit of kind 'referral', so it appears in the balance, the Candy desk and the
-- audit trail with no second points system. Idempotent; whole file in one transaction.

BEGIN;

-- The ledger learns one more kind of credit.
ALTER TABLE candy_ledger DROP CONSTRAINT IF EXISTS candy_ledger_kind_chk;
ALTER TABLE candy_ledger ADD CONSTRAINT candy_ledger_kind_chk
  CHECK (kind IN ('daily_best','ranked_run','all_boards','placing','spend','referral'));

-- One unguessable invite token per player per event. It is NOT the player id and
-- reveals nothing about the account. `visits` counts landings (analytics only).
CREATE TABLE IF NOT EXISTS referral_codes (
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  event_id   TEXT NOT NULL
               CONSTRAINT referral_codes_event_chk CHECK (event_id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  token      TEXT NOT NULL UNIQUE
               CONSTRAINT referral_codes_token_chk CHECK (token ~ '^[A-Z0-9]{12}$'),
  visits     INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, event_id)
);

-- One row per referred player per event: the FIRST attribution wins and is never
-- overwritten (UNIQUE below). status:
--   pending     attributed; the friend has no accepted ranked run yet
--   rewarded    paid: `ledger_id` is the candy credit
--   capped      qualified, but the referrer was already at the cap: no candy
--   ineligible  never rewardable (see `reason`); kept for the suspicious-activity view
--   revoked     was rewarded; an admin revoked it (the candy credit is revoked too)
CREATE TABLE IF NOT EXISTS referrals (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id    TEXT NOT NULL,
  referrer_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  referred_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CONSTRAINT referrals_status_chk CHECK (status IN ('pending','rewarded','capped','ineligible','revoked')),
  reason      TEXT CONSTRAINT referrals_reason_chk CHECK (reason IS NULL OR char_length(reason) <= 500),
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  qualified_at  TIMESTAMPTZ,
  amount      INTEGER NOT NULL DEFAULT 0,
  -- The idempotency key of the candy credit this referral paid (NULL until rewarded).
  award_key   TEXT UNIQUE,
  ledger_id   BIGINT REFERENCES candy_ledger(id) ON DELETE SET NULL,
  CONSTRAINT referrals_unique_referred UNIQUE (event_id, referred_id),
  CONSTRAINT referrals_no_self_chk CHECK (referrer_id <> referred_id)
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (event_id, referrer_id, status);

-- Aggregate share counters (post/comment/link/message copies), one row per day.
-- No player, no device: a count and nothing else.
CREATE TABLE IF NOT EXISTS referral_counters (
  event_id TEXT NOT NULL,
  kind     TEXT NOT NULL CONSTRAINT referral_counters_kind_chk
             CHECK (kind IN ('post_copy','comment_copy','link_copy','message_copy','invite_open')),
  day      DATE NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, kind, day)
);

-- Admin overrides of the code-defined defaults (enabled / bonus / cap). One row.
CREATE TABLE IF NOT EXISTS referral_settings (
  event_id   TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  bonus      INTEGER NOT NULL CONSTRAINT referral_settings_bonus_chk CHECK (bonus BETWEEN 0 AND 100),
  cap        INTEGER NOT NULL CONSTRAINT referral_settings_cap_chk CHECK (cap BETWEEN 0 AND 20),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every admin change (settings, a revocation), written with the change it records.
CREATE TABLE IF NOT EXISTS referral_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL CONSTRAINT referral_log_action_chk CHECK (action IN ('set-settings','revoke')),
  referral_id BIGINT REFERENCES referrals(id) ON DELETE SET NULL,
  reason      TEXT CONSTRAINT referral_log_reason_chk CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_log_created_idx ON referral_log (created_at DESC);

COMMIT;
