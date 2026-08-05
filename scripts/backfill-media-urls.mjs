#!/usr/bin/env node
/**
 * Fill `game_media.blob_url` for rows created before that column existed.
 *
 * WHY THIS EXISTS. `app/game-media/[slug]/[[...path]]/route.ts` needs an
 * object's Vercel Blob URL to stream it. It used to obtain that with a `head()`
 * on EVERY request — a billed Blob "simple operation" per image per page view.
 * Uploads now record the URL that `put()` returns, but rows written before
 * `scoreboard/migrations/015_game_media_url.sql` have NULL there.
 *
 * The route self-heals those rows (one `head()` each, then never again), so this
 * script is an optimisation, not a requirement: it does the whole table from a
 * single `list()` — one advanced operation instead of one simple operation per
 * legacy image — and gets it done before real traffic pays for it.
 *
 * Safe to re-run. Only ever writes rows whose `blob_url IS NULL`, so it cannot
 * clobber a URL recorded at upload time, and it reports rows it could not match
 * rather than inventing a value.
 *
 * Usage: npm run backfill-media-urls [-- --dry-run]
 *        (needs BLOB_READ_WRITE_TOKEN and DATABASE_URL, or .env.local)
 */

import { list } from "@vercel/blob";
import { Pool } from "@neondatabase/serverless";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");

// Both credentials live in .env.local for local runs; in CI they are real env
// vars and loadEnvFile would throw on the missing file.
if (!process.env.BLOB_READ_WRITE_TOKEN || !process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(path.join(rootDir, ".env.local"));
  } catch {
    // Absent .env.local is fine — the checks below report what is missing.
  }
}

const missing = ["BLOB_READ_WRITE_TOKEN", "DATABASE_URL"].filter(
  (key) => !process.env[key],
);
if (missing.length > 0) {
  console.error(
    `error: ${missing.join(" and ")} not set and .env.local did not provide ${
      missing.length > 1 ? "them" : "it"
    }`,
  );
  process.exit(1);
}

/** Every media object's pathname -> URL, from ONE paginated listing. */
async function listMediaUrls() {
  const urls = new Map();
  let cursor;
  do {
    const page = await list({ prefix: "game-media/", cursor });
    for (const blob of page.blobs) urls.set(blob.pathname, blob.url);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return urls;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let exitCode = 0;

try {
  const { rows: pending } = await pool.query(
    "SELECT blob_path FROM game_media WHERE blob_url IS NULL ORDER BY blob_path",
  );
  if (pending.length === 0) {
    console.log("nothing to do — every game_media row already has a blob_url");
    process.exit(0);
  }
  console.log(`${pending.length} row(s) missing blob_url; listing blob store…`);

  const urls = await listMediaUrls();
  console.log(`listed ${urls.size} object(s) under game-media/`);

  let filled = 0;
  const orphans = [];
  for (const { blob_path: blobPath } of pending) {
    const url = urls.get(blobPath);
    if (!url) {
      // A row whose object is gone. Left alone deliberately: deleting rows is a
      // decision for the dashboard, and the serving route already 404s these.
      orphans.push(blobPath);
      continue;
    }
    if (!dryRun) {
      await pool.query(
        "UPDATE game_media SET blob_url = $1 WHERE blob_path = $2 AND blob_url IS NULL",
        [url, blobPath],
      );
    }
    filled += 1;
    console.log(`${dryRun ? "would fill" : "filled"}  ${blobPath}`);
  }

  for (const blobPath of orphans) {
    console.warn(`no blob found for row  ${blobPath}`);
  }
  console.log(
    `\n${dryRun ? "[dry run] " : ""}${filled} filled, ${orphans.length} without a matching object`,
  );
  if (orphans.length > 0) exitCode = 1;
} catch (error) {
  console.error("backfill failed:", error);
  exitCode = 1;
} finally {
  await pool.end();
}

process.exit(exitCode);
