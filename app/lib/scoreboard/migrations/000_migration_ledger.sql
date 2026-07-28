-- HallPass — the migration ledger.
--
-- Numbered 000 because it must exist before any other migration can be tracked;
-- `scripts/migrate.mjs` applies this file first, unconditionally, before it even
-- reads which migrations have run.
--
-- WHY THIS EXISTS. Migrations 001–005 were applied BY HAND with nothing recording
-- what had run where. That is not a theoretical risk — it already bit: production
-- was found to be missing `004_player_favorites.sql` and `005_external_games.sql`
-- while the code for both features was live on `main`. Because every cached read
-- in this codebase is fail-soft (try/catch → `[]`), the symptom was not an error,
-- it was silence: signed-in favourites never persisted server-side, and external
-- games could not be created at all. A ledger turns that class of bug from
-- "discovered months later by accident" into "printed by `npm run migrate`".
--
-- `checksum` is a sha256 of the file body at the time it was applied. The runner
-- compares it on every run and warns loudly on a mismatch, which catches the other
-- silent failure mode: someone editing a migration that has already shipped, so
-- two databases disagree about what "005" means.
--
-- `filename` (not an integer version) is the primary key so the ledger stays
-- readable and so out-of-order backfills are representable — with schema changes
-- landing from several feature branches, strictly monotonic application order is
-- not a promise worth encoding in the table.
--
-- This file is idempotent and safe to re-apply.

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum   TEXT
);
