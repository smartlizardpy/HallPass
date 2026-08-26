#!/usr/bin/env node
// Publish a game's LOCAL index.html to Vercel Blob — the repo→Blob direction
// that `sync-games` does not have.
//
// WHY THIS EXISTS. Blob is the live copy of every game; `public/games/<slug>/`
// is a MIRROR of it, refreshed Blob→repo by `sync-games`, which the deploy
// workflow runs BEFORE the build. So editing a game in the repo and merging it
// does nothing: the next deploy overwrites the edit with the blob copy and
// ships that. The edit is not rejected, it is silently discarded, and the game
// keeps running the old code — which is exactly how a fix can be merged, green,
// deployed, and still absent in a private window.
//
// The supported ways to change a game are the dashboard's upload/paste panel
// and this script. Both end at the same three writes: put
// `games/<slug>/index.html`, record that blob in `game_blobs`, and bump the
// `games_version` counter so installed clients refresh their cached copy.
//
// WHY THIS SCRIPT NEEDS THE DATABASE NOW. The serving route stopped asking Blob
// which games have an override — a `list()` is a billed ADVANCED operation and
// it was 98% of the site's advanced spend — and reads the `game_blobs` mirror
// instead (see `app/lib/game-blob-index.ts`). So a blob written WITHOUT its row
// is invisible: the route falls back to the baked-in `public/games/` twin, which
// on this script's own repo→Blob path happens to be the same bytes, but on any
// later edit would silently serve the old copy. Writing the row here is what
// keeps "published from a laptop" and "published from the dashboard" the same
// operation. The version counter moved into that database too, for the same
// reason: it used to be a `games/version.txt` blob costing one advanced write
// per publish and a simple read per poll window.
//
// SINGLE-FILE GAMES ONLY, deliberately. A bundle's publish also has to delete
// the files a new upload orphans (`writeGameHtml` in the dashboard does that
// with the same index), and getting that wrong deletes a live game's assets.
// Bundles keep going through the dashboard; this refuses them loudly.
//
// Usage:
//   npm run publish-game -- <slug>          # dry run: says what it would do
//   npm run publish-game -- <slug> --yes    # actually writes
//
// Needs BLOB_READ_WRITE_TOKEN and DATABASE_URL, or a .env.local providing them.

import { neon } from "@neondatabase/serverless";
import { head, put } from "@vercel/blob";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Files allowed to sit beside index.html in a "single-file" game. */
const REPO_ONLY_FILES = new Set(["cover.png"]);

if (!process.env.BLOB_READ_WRITE_TOKEN || !process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(path.join(rootDir, ".env.local"));
  } catch {
    // .env.local may be absent — the checks below report it either way.
  }
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error(
    "error: BLOB_READ_WRITE_TOKEN is not set and .env.local did not provide it",
  );
  process.exit(1);
}
// Hard requirement, not a warning: a blob published without its index row is a
// blob the serving route cannot see. Refusing up front beats a half-publish.
if (!process.env.DATABASE_URL) {
  console.error(
    "error: DATABASE_URL is not set and .env.local did not provide it.\n" +
      "       It is needed to record the published blob in game_blobs; without\n" +
      "       that row the serving route will not see this upload.",
  );
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("-"));
const confirmed = args.includes("--yes");

if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error("usage: npm run publish-game -- <slug> [--yes]");
  process.exit(1);
}

const slugDir = path.join(rootDir, "public", "games", slug);
if (!existsSync(slugDir) || !statSync(slugDir).isDirectory()) {
  console.error(`error: no public/games/${slug}/ to publish`);
  process.exit(1);
}

const localFiles = (await readdir(slugDir)).sort();
const extras = localFiles.filter(
  (f) => f !== "index.html" && !REPO_ONLY_FILES.has(f),
);
if (!localFiles.includes("index.html")) {
  console.error(`error: public/games/${slug}/index.html does not exist`);
  process.exit(1);
}
if (extras.length > 0) {
  console.error(
    `error: ${slug} is a multi-file bundle (${extras.join(", ")}).\n` +
      "       Publish it through the dashboard, which also removes the files a\n" +
      "       new upload orphans. This script only handles a lone index.html.",
  );
  process.exit(1);
}

const html = await readFile(path.join(slugDir, "index.html"), "utf8");
const localHash = createHash("sha256").update(html).digest("hex").slice(0, 12);

// What is live right now, so the operator can see what they are replacing.
// `head()` on the one path we care about rather than a `list()` of the prefix:
// head is a SIMPLE Blob operation (10,000/month) and list is an ADVANCED one
// (2,000/month), and this only ever wants a single known key. A miss means
// nothing is published yet, which is not an error.
const blobPath = `games/${slug}/index.html`;
let live = null;
try {
  live = await head(blobPath);
} catch {
  live = null;
}

let liveHash = null;
if (live) {
  try {
    const res = await fetch(live.url, { cache: "no-store" });
    const body = await res.text();
    liveHash = createHash("sha256").update(body).digest("hex").slice(0, 12);
  } catch {
    // Non-fatal: the comparison is a courtesy, not a gate.
  }
}

console.log(`game:        ${slug}`);
console.log(`local:       ${html.length} bytes  sha256:${localHash}`);
console.log(
  live
    ? `published:   ${live.size} bytes  sha256:${liveHash ?? "unreadable"}  uploaded ${live.uploadedAt.toISOString()}`
    : "published:   (nothing yet — this would be the first upload)",
);

if (liveHash && liveHash === localHash) {
  console.log("\nidentical — nothing to publish.");
  process.exit(0);
}

if (!confirmed) {
  console.log(
    "\nDRY RUN. Nothing was written. Re-run with --yes to publish, which will:\n" +
      `  1. overwrite ${blobPath}\n` +
      "  2. record it in game_blobs so the serving route can see it\n" +
      "  3. bump games_version so installed clients refresh their cached copy",
  );
  process.exit(0);
}

// The same three writes, with the same options, the dashboard's publish performs.
const uploaded = await put(blobPath, html, {
  access: "public",
  contentType: "text/html; charset=utf-8",
  addRandomSuffix: false,
  allowOverwrite: true,
  cacheControlMaxAge: 60,
});
console.log(`\npublished ${blobPath}`);

// NOT best-effort, unlike the bump below: without this row the serving route
// does not know the blob exists. Mirrors `recordGameBlobs()`.
await sql`
  INSERT INTO game_blobs (pathname, slug, url, size, uploaded_at)
  VALUES (${blobPath}, ${slug}, ${uploaded.url}, ${Buffer.byteLength(html)}, now())
  ON CONFLICT (pathname) DO UPDATE
    SET url = EXCLUDED.url, size = EXCLUDED.size, uploaded_at = EXCLUDED.uploaded_at
`;
console.log("recorded in game_blobs");

// Best-effort, exactly as `bumpGamesVersion()` treats it: the game is already
// live, and a missed bump only means installed clients lag until the next one.
try {
  await sql`
    INSERT INTO app_settings (key, value, updated_by)
    VALUES ('games_version', ${String(Date.now())}, 'publish-game.mjs')
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
  `;
  console.log("bumped games_version");
} catch (error) {
  console.warn(`warning: could not bump the games version: ${error.message}`);
}

// NOT REVALIDATED FROM HERE, and this is the one caveat worth knowing. The
// dashboard's publish path calls `updateTag(GAMES_BLOB_CACHE_TAG)` right after
// writing, so the new blob is visible on the very next request. A script cannot
// reach Next's data cache, so the deployed app keeps its cached read of the
// index until the TTL in `game-blob-index.ts` expires (1h). Redeploy to clear it
// sooner.
console.log(
  "\nNote: the deployed app caches the blob index for up to an hour, so the\n" +
    "change may take that long to appear. Redeploy to clear it immediately.",
);
