#!/usr/bin/env node
/**
 * HallPass — create the Postgres role the analytics MCP reads through.
 *
 * WHY THIS EXISTS. `run_analytics_sql` lets a language model write its own
 * SELECT, and migration `031` shapes what it should see: a `mcp` schema of
 * views with every personal column stripped out. But a view is not a
 * permission. A connection holding the app's own role can
 * `SELECT email FROM public.players` no matter how many careful views sit
 * beside it, so the views only become a boundary once something reads through
 * them that CANNOT read around them.
 *
 * That something is this role. It gets USAGE on `mcp`, SELECT on its views, and
 * nothing whatsoever on `public`. Postgres grants a new role no table
 * privileges by default, so "nothing on public" is mostly a matter of not
 * granting any — but "mostly" is not a security posture, which is why the last
 * thing this script does is RECONNECT AS THE NEW ROLE AND TRY TO READ
 * `public.players`, and exit non-zero if it succeeds. A privilege leak that
 * announces itself is a bad afternoon; one that does not is the only failure
 * this feature cannot have.
 *
 * The views must NOT be `security_invoker`. Postgres checks a view's
 * permissions as its owner by default, and that default is the entire
 * mechanism: it is what lets a role with nothing on `public` read through to
 * `public.players`. Migration `031`'s header says the same thing from the other
 * side.
 *
 * USAGE
 *   node scripts/provision-mcp-reader.mjs               # dry run: report only
 *   node scripts/provision-mcp-reader.mjs --yes         # create / re-grant
 *   node scripts/provision-mcp-reader.mjs --yes --rotate  # also reset the password
 *
 * IDEMPOTENT. Re-running re-asserts the grants, which is the repair path when a
 * later migration adds a view (the ALTER DEFAULT PRIVILEGES below covers views
 * created AFTER this runs, but not ones created before a first run).
 *
 * It prints the connection string to put in `MCP_ANALYTICS_DATABASE_URL` and
 * never writes it anywhere: a password echoed into a file is a password in a
 * backup. Without that variable the SQL tool is simply not registered — it
 * never falls back to `DATABASE_URL`, because a fail-open here reads every
 * child's email address.
 */

import { randomBytes } from "node:crypto";
import { Pool } from "@neondatabase/serverless";

const ROLE = "mcp_reader";
const SCHEMA = "mcp";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--yes");
const ROTATE = args.has("--rotate");

try {
  process.loadEnvFile(".env.local");
} catch {
  // Running with the environment already set (CI, or an operator who exported
  // it) is normal; only a MISSING connection string is fatal, below.
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[mcp-reader] DATABASE_URL is not set. Nothing to connect to.");
  process.exit(1);
}

/**
 * A password Postgres will accept inside a quoted literal without escaping
 * games: base64url is alphanumeric plus `-` and `_`, so there is no quote to
 * break out of. 32 bytes.
 */
function newPassword() {
  return randomBytes(32).toString("base64url").replace(/=+$/, "");
}

/** `host` from a connection string, for the summary line. */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
}

/** Swap the credentials of a connection string for the reader's. */
function readerUrl(base, role, password) {
  const url = new URL(base);
  url.username = role;
  url.password = password;
  return url.toString();
}

const pool = new Pool({ connectionString });

try {
  console.log(`[mcp-reader] target: ${hostOf(connectionString)}`);

  const { rows: existing } = await pool.query(
    "SELECT 1 FROM pg_roles WHERE rolname = $1",
    [ROLE],
  );
  const roleExists = existing.length > 0;

  const { rows: views } = await pool.query(
    "SELECT table_name FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name",
    [SCHEMA],
  );
  if (views.length === 0) {
    console.error(
      `[mcp-reader] schema "${SCHEMA}" has no views. Run \`npm run migrate\` first — ` +
        "031_mcp_analytics_views.sql creates them.",
    );
    process.exit(1);
  }

  console.log(`[mcp-reader] role ${ROLE}: ${roleExists ? "exists" : "MISSING"}`);
  console.log(`[mcp-reader] ${views.length} views in schema "${SCHEMA}"`);

  if (!APPLY) {
    console.log("[mcp-reader] dry run — nothing written. Re-run with --yes to apply.");
    process.exit(0);
  }

  const password = !roleExists || ROTATE ? newPassword() : null;

  if (!roleExists) {
    await pool.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}'`);
    console.log(`[mcp-reader] created role ${ROLE}`);
  } else if (ROTATE) {
    await pool.query(`ALTER ROLE ${ROLE} PASSWORD '${password}'`);
    console.log(`[mcp-reader] rotated the password for ${ROLE}`);
  }

  // The grants, re-asserted every run so a view added by a later migration is
  // picked up by re-running rather than by remembering a manual GRANT.
  await pool.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${ROLE}`);
  await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${ROLE}`);
  await pool.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${SCHEMA} GRANT SELECT ON TABLES TO ${ROLE}`,
  );
  // So an unqualified `FROM players` in a model-written query resolves to the
  // view rather than erroring — the model should not have to know the schema
  // exists, and `pg_catalog` stays on the path so `information_schema`-style
  // introspection still works.
  await pool.query(`ALTER ROLE ${ROLE} SET search_path = ${SCHEMA}, pg_catalog`);
  console.log(`[mcp-reader] granted USAGE + SELECT on ${SCHEMA}, pinned search_path`);

  // ── THE PART THAT MATTERS ────────────────────────────────────────────────
  // Everything above is a claim. This is the check.
  if (!password) {
    console.log(
      "[mcp-reader] the role already existed and its password was not rotated, so the\n" +
        "             boundary could not be re-verified from here. Re-run with --rotate\n" +
        "             to get a connection string and prove it.",
    );
    process.exit(0);
  }

  const url = readerUrl(connectionString, ROLE, password);
  const readerPool = new Pool({ connectionString: url });
  let leaked = false;
  try {
    await readerPool.query("SELECT 1 FROM public.players LIMIT 1");
    leaked = true;
  } catch {
    // The expected path: permission denied.
  }

  let canReadViews = false;
  try {
    await readerPool.query(`SELECT 1 FROM ${SCHEMA}.players LIMIT 1`);
    canReadViews = true;
  } catch (error) {
    console.error("[mcp-reader] the reader CANNOT read its own views:", error.message);
  }

  let canWrite = false;
  try {
    await readerPool.query(`DELETE FROM ${SCHEMA}.scores`);
    canWrite = true;
  } catch {
    // The expected path: a view over a table it has no INSERT/UPDATE/DELETE on.
  }
  await readerPool.end();

  if (leaked) {
    console.error(
      `[mcp-reader] FAILED: ${ROLE} can read public.players. The view layer is NOT a\n` +
        "             boundary on this database. Do not set MCP_ANALYTICS_DATABASE_URL.",
    );
    process.exit(1);
  }
  if (!canReadViews) {
    console.error("[mcp-reader] FAILED: the grants did not take. Not safe to use.");
    process.exit(1);
  }
  if (canWrite) {
    console.error(`[mcp-reader] FAILED: ${ROLE} can WRITE through the views.`);
    process.exit(1);
  }

  console.log("[mcp-reader] verified: public.players unreadable, mcp views readable, writes refused");
  console.log("");
  console.log("Put this in .env.local and on the deployment:");
  console.log("");
  console.log(`MCP_ANALYTICS_DATABASE_URL=${url}`);
  console.log("");
  console.log("It is not stored anywhere else. Re-run with --rotate to mint a new one.");
} finally {
  await pool.end();
}
