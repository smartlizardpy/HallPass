-- HallPass — Hall Tokens: canonical fresh-install DDL.
--
-- Mirrors migrations/053_hall_tokens.sql (which carries the reasoning); keep the
-- two in lockstep. Requires `players` and `player_packs`.

-- THE LEDGER, append-only, like candy_ledger but with no event: the currency is
-- permanent. A balance is `sum(amount) WHERE revoked_at IS NULL`, so there is no
-- counter to drift. Credits > 0, spends < 0. `award_key` is the idempotency key.
CREATE TABLE IF NOT EXISTS token_ledger (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id      TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  amount         INTEGER NOT NULL
                   CONSTRAINT token_ledger_amount_chk CHECK (amount BETWEEN -100000 AND 100000 AND amount <> 0),
  kind           TEXT NOT NULL
                   CONSTRAINT token_ledger_kind_chk CHECK (kind IN ('play','streak','sell_back','spend')),
  award_key      TEXT NOT NULL UNIQUE
                   CONSTRAINT token_ledger_award_key_chk CHECK (char_length(award_key) BETWEEN 1 AND 300),
  ref            TEXT CONSTRAINT token_ledger_ref_chk CHECK (ref IS NULL OR char_length(ref) <= 200),
  -- The sealed pack a spend bought (debit and grant are one transaction).
  player_pack_id BIGINT REFERENCES player_packs(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,
  revoked_by     TEXT,
  revoked_reason TEXT CONSTRAINT token_ledger_revoked_reason_chk CHECK (revoked_reason IS NULL OR char_length(revoked_reason) <= 500),
  CONSTRAINT token_ledger_sign_chk CHECK ((kind = 'spend') = (amount < 0)),
  CONSTRAINT token_ledger_spend_pack_chk CHECK (player_pack_id IS NULL OR kind = 'spend'),
  CONSTRAINT token_ledger_spend_final_chk CHECK (kind <> 'spend' OR revoked_at IS NULL),
  CONSTRAINT token_ledger_revoke_who_chk CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX IF NOT EXISTS token_ledger_player_idx ON token_ledger (player_id, created_at DESC);

-- A market pack's grant source (collectibles/schema.sql lists it too).
ALTER TABLE player_packs DROP CONSTRAINT IF EXISTS player_packs_source_chk;
ALTER TABLE player_packs ADD CONSTRAINT player_packs_source_chk
  CHECK (source IN ('championship','admin','event','market'));
