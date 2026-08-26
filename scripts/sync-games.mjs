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
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const gamesDir = path.join(rootDir, "public", "games");
const mirrorStampPath = path.join(rootDir, "app", "lib", "mirror-synced-at.ts");

// Captured BEFORE listing the store, so any blob uploaded while this sync runs
// has an `uploadedAt` after the stamp and the serving route treats it as newer
// than the mirror (proxied) rather than as already-baked-in (served static, and
// possibly 404 if this run didn't capture it).
const syncStartedAt = Date.now();

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
// RETIRED PWA update sentinel that shared the games/ prefix — never write it to
// disk. The counter now lives in app_settings (see app/lib/games-version.ts), so
// nothing writes this key any more, but the skip stays: the object itself is
// still in the store until somebody deletes it, and mirroring it would drop a
// stray version.txt into public/games/ and thence into the repo.
const VERSION_SENTINEL = "games/version.txt";
// Matches the segment cap in app/game-html/[slug]/[[...path]]/route.ts.
const MAX_PATH_SEGMENTS = 10;

let synced = 0;
let skipped = 0;
/** Local files whose contents the sync replaced — see the warning at the end. */
const overwritten = [];
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

    // REPORT WHAT THIS DESTROYS. The sync is Blob→repo and unconditional, so a
    // game edited in the repo and merged is silently overwritten here, BEFORE
    // the build, and the deploy ships the old blob copy instead. That has
    // already cost one merged, green, deployed fix that never reached a player.
    // The overwrite still happens — Blob is the live copy and the mirror must
    // match it — but it is no longer invisible, and the summary names the file
    // so CI logs answer "why is my change not live?" on their own.
    const clobbered =
      existsSync(dest) && !(await readFile(dest)).equals(body);

    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(tmp, body);
    await rename(tmp, dest);
    if (clobbered) {
      overwritten.push(pathname);
      logItem(pathname, "ok (WARN: replaced a DIFFERENT local copy)");
    } else {
      logItem(pathname, "ok");
    }
    synced += 1;
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    logItem(pathname, `FAIL (${err instanceof Error ? err.message : err})`);
    failed += 1;
  }
}

console.log();
console.log(`synced: ${synced}   skipped: ${skipped}   failed: ${failed}`);

if (overwritten.length > 0) {
  console.log();
  console.log(
    `WARNING: ${overwritten.length} local game file(s) differed from Blob and were replaced:`,
  );
  for (const p of overwritten) console.log(`  ${p}`);
  console.log(
    "If one of those was an intentional repo edit, it is NOT going to ship —\n" +
      "Blob is the live copy. Publish it with: npm run publish-game -- <slug> --yes",
  );
}

// Stamp the mirror ONLY on a clean run. A partial sync leaves some blobs
// un-mirrored; advancing the stamp then would make the route treat those missing
// files as already-baked-in and 307 them to a 404. Leaving the old stamp keeps
// them newer-than-mirror, so they stay proxied from Blob until a clean sync.
if (failed > 0) {
  process.exitCode = 1;
} else {
  try {
    const src = await readFile(mirrorStampPath, "utf8");
    const next = src.replace(
      /export const MIRROR_SYNCED_AT = \d+;/,
      `export const MIRROR_SYNCED_AT = ${syncStartedAt};`,
    );
    if (next === src) {
      console.log(
        "warn: could not find MIRROR_SYNCED_AT to update — commit the mirror stamp by hand",
      );
    } else {
      await writeFile(mirrorStampPath, next);
      console.log(`stamped mirror-synced-at.ts: ${syncStartedAt}`);
      console.log("commit app/lib/mirror-synced-at.ts alongside public/games/");
    }
  } catch (err) {
    console.log(
      `warn: failed to stamp mirror-synced-at.ts (${err instanceof Error ? err.message : err})`,
    );
  }
}
