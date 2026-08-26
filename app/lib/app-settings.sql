-- HallPass — operator-controlled runtime settings. Canonical fresh-install DDL.
--
-- Kept in lockstep with `app/lib/scoreboard/migrations/026_blob_ops.sql`, which
-- is the same body wrapped in BEGIN/COMMIT.
--
-- WHAT THIS IS FOR. Two things a deploy should not be needed to change:
--
--   1. The ADVANCED-BLOB-OPERATION KILL SWITCHES (`blob_op:<id>`). Vercel bills
--      `put`, `copy` and `list` as "advanced operations" against an allowance
--      that is an order of magnitude smaller than the simple-operation one, and
--      when it runs out every one of them starts failing. The switches let a
--      super admin turn OFF the features that spend them — one at a time or all
--      at once — so the store is preserved for whatever matters most that month,
--      and so the affected surfaces refuse cleanly with an explanation instead
--      of throwing a blob error at an admin mid-upload. See `app/lib/blob-ops.ts`
--      for the registry of switchable features.
--
--   2. The GAMES VERSION counter (`games_version`). It used to be the
--      `uploadedAt` of a `games/version.txt` blob, which cost one `put()`
--      (advanced) per source change and one `head()` (simple) per cache window
--      forever after. It is a monotonic number that changes only when an admin
--      publishes; a row is a strictly better home for it than an object store.
--
-- WHY ONE KEY/VALUE TABLE AND NOT A COLUMN PER SETTING. Every value here is
-- operational rather than domain data: it is read by one module, written by one
-- action, and its schema is "whatever that module says it is". A typed column
-- per switch would mean a migration every time a new blob-spending feature is
-- added, which is exactly the friction this table exists to remove. Domain data
-- does NOT belong here — it gets a real table with real constraints.
--
-- VALUES ARE TEXT, PARSED BY THE READER. `'1'`/`'0'` for the switches, a decimal
-- integer for the version. Deliberately not JSONB: nothing here is queried by
-- its contents, and a text column keeps `--status`-style inspection readable
-- with a plain `SELECT`.

CREATE TABLE IF NOT EXISTS app_settings (
  -- Namespaced by convention (`blob_op:game_source`), never parsed as structure.
  -- The length cap is a guard against a caller building a key from user input;
  -- every key in use is a compile-time literal.
  key        TEXT PRIMARY KEY
               CONSTRAINT app_settings_key_length CHECK (char_length(key) BETWEEN 1 AND 128),

  -- Opaque to the table, meaningful to whichever module owns the key.
  value      TEXT NOT NULL
               CONSTRAINT app_settings_value_length CHECK (char_length(value) <= 4096),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Who last changed it, for tracing. No foreign key to `dashboard_users(email)`
  -- — same rule as `game_videos.added_by`: revoking somebody's access must not
  -- erase the record of what they did. NULL for values written by a script or a
  -- migration rather than by a person.
  updated_by TEXT
);
