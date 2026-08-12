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
// and this script. Both end at the same two writes the dashboard performs:
// put `games/<slug>/index.html`, then bump `games/version.txt` so installed
// clients refresh their cached copy.
//
// SINGLE-FILE GAMES ONLY, deliberately. A bundle's publish also has to delete
// the files a new upload orphans (`writeGameHtml` in the dashboard does that
// with `listGameFiles`), and getting that wrong deletes a live game's assets.
// Bundles keep going through the dashboard; this refuses them loudly.
//
// Usage:
//   npm run publish-game -- <slug>          # dry run: says what it would do
//   npm run publish-game -- <slug> --yes    # actually writes
//
// Needs BLOB_READ_WRITE_TOKEN, or a .env.local that provides it.

import { list, put } from "@vercel/blob";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_SENTINEL = "games/version.txt";

/** Files allowed to sit beside index.html in a "single-file" game. */
const REPO_ONLY_FILES = new Set(["cover.png"]);

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  try {
    process.loadEnvFile(path.join(rootDir, ".env.local"));
  } catch {
    // .env.local may be absent — the check below reports it either way.
  }
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error(
    "error: BLOB_READ_WRITE_TOKEN is not set and .env.local did not provide it",
  );
  process.exit(1);
}

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
const blobPath = `games/${slug}/index.html`;
let live = null;
try {
  const { blobs } = await list({ prefix: `games/${slug}/` });
  live = blobs.find((b) => b.pathname === blobPath) ?? null;
} catch (error) {
  console.error("error: could not list the game's blobs:", error.message);
  process.exit(1);
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
      `  2. bump ${VERSION_SENTINEL} so installed clients refresh their cached copy`,
  );
  process.exit(0);
}

// The same two writes, with the same options, the dashboard's publish performs.
await put(blobPath, html, {
  access: "public",
  contentType: "text/html; charset=utf-8",
  addRandomSuffix: false,
  allowOverwrite: true,
  cacheControlMaxAge: 60,
});
console.log(`\npublished ${blobPath}`);

// Best-effort, exactly as `bumpGamesVersion()` treats it: the game is already
// live, and a missed bump only means installed clients lag until the next one.
try {
  await put(VERSION_SENTINEL, String(Date.now()), {
    access: "public",
    contentType: "text/plain; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  console.log(`bumped ${VERSION_SENTINEL}`);
} catch (error) {
  console.warn(`warning: could not bump the version sentinel: ${error.message}`);
}

// NOT REVALIDATED FROM HERE, and this is the one caveat worth knowing. The
// dashboard's publish path calls `revalidateTag(GAMES_BLOB_CACHE_TAG)` right
// after writing, so the new blob is visible on the very next request. A script
// cannot reach Next's data cache, so the serving-blob listing keeps its cached
// answer until the TTL in `game-serving-blobs.ts` expires (1h). Redeploy to
// clear it sooner.
console.log(
  "\nNote: the serving-blob listing is cached for up to an hour, so the change\n" +
    "may take that long to appear. Redeploy to clear it immediately.",
);
