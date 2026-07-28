#!/usr/bin/env node
/**
 * HallPass — the migration runner.
 *
 * Applies every `.sql` file in `app/lib/scoreboard/migrations/` that the target
 * database has not recorded in `schema_migrations`, in filename order.
 *
 * WHY THIS EXISTS. Migrations used to be applied by hand with nothing tracking
 * what had run where, and it already went wrong: production was missing
 * `004_player_favorites.sql` and `005_external_games.sql` while the code for both
 * was live. Because every cached read in this codebase is fail-soft (try/catch →
 * `[]`), nothing errored — signed-in favourites silently never persisted and
 * external games silently could not be created. `--status` is the cheap check
 * that makes that class of drift visible instead of invisible.
 *
 * WHY `Pool` AND NOT THE `neon()` HTTP DRIVER USED BY THE APP. The HTTP driver
 * (`app/lib/db.ts`) sends one statement per stateless round trip, so a `BEGIN` in
 * one call and a `COMMIT` in another are not the same transaction — a migration
 * that half-applied would leave the schema torn. `Pool` speaks the real Postgres
 * wire protocol over a WebSocket, so each file's own `BEGIN; … COMMIT;` is an
 * actual transaction. Files without one still run atomically: a multi-statement
 * simple-protocol query is wrapped in an implicit transaction by Postgres.
 *
 * Node 22+ ships a global `WebSocket`, which `@neondatabase/serverless` picks up
 * automatically, so no `ws` dependency is needed.
 *
 * Usage:
 *   npm run migrate -- --status               show applied/pending, change nothing
 *   npm run migrate                            apply everything pending
 *   npm run migrate -- --dry-run               list what WOULD be applied
 *   npm run migrate -- --baseline-through=003  record 001..003 as already applied
 *                                              WITHOUT running them
 *
 * `--baseline-through` exists for databases that predate this runner. Use it only
 * after confirming with `--status` (and a look at the actual tables) which
 * migrations that database really has. Baselining a migration the database does
 * NOT have is how you permanently skip it.
 *
 * Reads `DATABASE_URL` from the environment, falling back to `.env.local` — the
 * same convention as `scripts/sync-games.mjs`. It always prints which host it is
 * about to touch, because "which branch am I pointed at" is the question you most
 * want answered before a schema change.
 */

import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "@neondatabase/serverless";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(rootDir, "app/lib/scoreboard/migrations");
const LEDGER_FILE = "000_migration_ledger.sql";

// ---------- args ----------
const args = process.argv.slice(2);
const wantStatus = args.includes("--status");
const dryRun = args.includes("--dry-run");
const baselineArg = args.find((a) => a.startsWith("--baseline-through="));
const baselineThrough = baselineArg ? baselineArg.split("=")[1] : null;

// ---------- env ----------
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(path.join(rootDir, ".env.local"));
  } catch {
    // .env.local may be absent (e.g. CI) — fall through to the check below.
  }
}
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "error: DATABASE_URL is not set and .env.local did not provide it",
  );
  process.exit(1);
}

/** Host only — never print the connection string, it carries the password. */
function describeTarget(url) {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Leading numeric prefix of a migration filename, e.g. "004_x.sql" → 4. */
function numericPrefix(filename) {
  const m = /^(\d+)/.exec(filename);
  return m ? Number(m[1]) : Number.NaN;
}

async function main() {
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.error(`error: no .sql files found in ${migrationsDir}`);
    process.exit(1);
  }

  const bodies = new Map();
  for (const f of files) {
    bodies.set(f, await readFile(path.join(migrationsDir, f), "utf8"));
  }

  console.log(`[migrate] target: ${describeTarget(connectionString)}`);

  const pool = new Pool({ connectionString });
  let exitCode = 0;

  try {
    const client = await pool.connect();
    try {
      // The ledger itself is always applied first and is never recorded as a
      // migration — it is the thing that does the recording. It is idempotent
      // (CREATE TABLE IF NOT EXISTS), so this is a no-op after the first run.
      if (bodies.has(LEDGER_FILE)) {
        await client.query(bodies.get(LEDGER_FILE));
      } else {
        console.error(`error: ${LEDGER_FILE} is missing — cannot track state`);
        process.exit(1);
      }

      const { rows } = await client.query(
        "SELECT filename, applied_at, checksum FROM schema_migrations",
      );
      const applied = new Map(rows.map((r) => [r.filename, r]));

      const pending = files.filter(
        (f) => f !== LEDGER_FILE && !applied.has(f),
      );

      // --- checksum drift: an already-applied file whose contents changed ---
      for (const f of files) {
        if (f === LEDGER_FILE) continue;
        const record = applied.get(f);
        if (!record?.checksum) continue;
        const current = sha256(bodies.get(f));
        if (current !== record.checksum) {
          console.warn(
            `[migrate] WARNING: ${f} was applied on ${new Date(
              record.applied_at,
            ).toISOString()} but its contents have CHANGED since.\n` +
              `           Databases that ran the old version will NOT pick up the edit.\n` +
              `           Ship a new migration instead of editing one that has shipped.`,
          );
          exitCode = 1;
        }
      }

      // --- --status: report and stop ---
      if (wantStatus) {
        console.log(`[migrate] applied: ${applied.size}, pending: ${pending.length}`);
        for (const f of files) {
          if (f === LEDGER_FILE) continue;
          const record = applied.get(f);
          console.log(
            record
              ? `  ✓ ${f}  (${new Date(record.applied_at).toISOString()})`
              : `  · ${f}  PENDING`,
          );
        }
        return;
      }

      // --- --baseline-through: record without running ---
      if (baselineThrough !== null) {
        const cutoff = numericPrefix(baselineThrough);
        if (Number.isNaN(cutoff)) {
          console.error(
            `error: --baseline-through expects a leading migration number, got "${baselineThrough}"`,
          );
          process.exit(1);
        }
        const toMark = files.filter(
          (f) =>
            f !== LEDGER_FILE &&
            !applied.has(f) &&
            numericPrefix(f) <= cutoff,
        );
        if (toMark.length === 0) {
          console.log("[migrate] baseline: nothing to record");
          return;
        }
        for (const f of toMark) {
          if (dryRun) {
            console.log(`[migrate] would baseline ${f} (not run)`);
            continue;
          }
          await client.query(
            "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING",
            [f, sha256(bodies.get(f))],
          );
          console.log(`[migrate] baselined ${f} (recorded, NOT run)`);
        }
        return;
      }

      // --- apply pending ---
      if (pending.length === 0) {
        console.log("[migrate] up to date — nothing to apply");
        return;
      }

      for (const f of pending) {
        if (dryRun) {
          console.log(`[migrate] would apply ${f}`);
          continue;
        }
        const body = bodies.get(f);
        console.log(`[migrate] applying ${f} …`);
        await client.query(body);
        // Recorded immediately after the file's own COMMIT. These are two
        // statements, so a crash between them would leave the migration applied
        // but unrecorded, and the next run would apply it again — which is
        // exactly why every migration must be written idempotently
        // (`IF NOT EXISTS` throughout; see 004_player_favorites.sql).
        await client.query(
          "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING",
          [f, sha256(body)],
        );
        console.log(`[migrate] applied  ${f}`);
      }
      console.log(`[migrate] done — ${pending.length} migration(s) applied`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error("[migrate] failed:", error?.message ?? error);
  process.exit(1);
});
