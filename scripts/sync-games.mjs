#!/usr/bin/env node
// Sync every game file from Vercel Blob (games/<slug>/<relPath>) into
// public/games/<slug>/<relPath>.
//
// Replaces the old curl-one-HTML-per-slug sync-games.sh: listing the blob
// store discovers multi-file games (JS, audio, images) that the
// index.html-only contract could not. Keeps its spirit: tmp-file + rename
// writes, per-item log lines, a final summary, non-zero exit on failures.
//
// Never deletes local files (cover.png exists only in the repo) and never
// writes blob paths that fail validation.
//
// Usage: npm run sync-games   (needs BLOB_READ_WRITE_TOKEN, or .env.local)

import { list } from "@vercel/blob";
import { existsSync, statSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const gamesDir = path.join(rootDir, "public", "games");

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  try {
    process.loadEnvFile(path.join(rootDir, ".env.local"));
  } catch {
    // .env.local may be absent (e.g. in CI) — fall through to the check below.
  }
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error(
    "error: BLOB_READ_WRITE_TOKEN is not set and .env.local did not provide it"
  );
  process.exit(1);
}

// Duplicated from isSafeSegment in app/lib/game-html-blob.ts (the source of
// truth) — an .mjs script cannot import the TS module. Keep in sync.
const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;
function isSafeSegment(segment) {
  return segment.length <= 128 && SAFE_SEGMENT_RE.test(segment);
}

const BLOB_PREFIX = "games/";
// PWA update sentinel sharing the games/ prefix — never write it to disk.
const VERSION_SENTINEL = "games/version.txt";
// Matches the segment cap in app/game-html/[slug]/[[...path]]/route.ts.
const MAX_PATH_SEGMENTS = 10;

let synced = 0;
let skipped = 0;
let failed = 0;

function logItem(pathname, outcome) {
  console.log(`sync ${pathname.padEnd(56)} ${outcome}`);
}

const blobs = [];
let cursor;
do {
  const page = await list({ prefix: BLOB_PREFIX, cursor });
  blobs.push(...page.blobs);
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);

for (const blob of blobs) {
  const { pathname, url } = blob;

  if (pathname === VERSION_SENTINEL) {
    logItem(pathname, "skip (PWA version sentinel)");
    skipped += 1;
    continue;
  }

  const segments = pathname.slice(BLOB_PREFIX.length).split("/");
  const [slug, ...relSegments] = segments;

  if (relSegments.length === 0) {
    logItem(pathname, "skip (warn: not games/<slug>/<relPath>)");
    skipped += 1;
    continue;
  }
  if (relSegments.length > MAX_PATH_SEGMENTS || !segments.every(isSafeSegment)) {
    logItem(pathname, "skip (warn: unsafe path)");
    skipped += 1;
    continue;
  }

  const slugDir = path.join(gamesDir, slug);
  if (!existsSync(slugDir) || !statSync(slugDir).isDirectory()) {
    logItem(pathname, `skip (warn: no local public/games/${slug}/ — deleted game?)`);
    skipped += 1;
    continue;
  }

  const dest = path.join(slugDir, ...relSegments);
  const tmp = `${dest}.tmp`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const body = Buffer.from(await res.arrayBuffer());
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(tmp, body);
    await rename(tmp, dest);
    logItem(pathname, "ok");
    synced += 1;
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    logItem(pathname, `FAIL (${err instanceof Error ? err.message : err})`);
    failed += 1;
  }
}

console.log();
console.log(`synced: ${synced}   skipped: ${skipped}   failed: ${failed}`);
if (failed > 0) {
  process.exitCode = 1;
}
