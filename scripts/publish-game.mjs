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
// BUNDLES ARE FIRST-PUBLISH ONLY unless you pass `--republish`, deliberately. A
// bundle's REpublish also has to delete the files a new upload orphans
// (`uploadBundleAction` in the dashboard does that with the same index), and
// getting that wrong deletes a live game's assets. So a multi-file game is accepted only when `game_blobs` has no
// `index.html` row for the slug yet — a first upload (or the retry of one that
// died part-way) has no live game to orphan — and is refused
// loudly otherwise. `--republish` is the explicit opt-in for the other case: it
// writes only the files whose bytes changed (by the `game_blobs.sha256`
// fingerprint, like the dashboard), then deletes the published files the folder
// no longer contains, under the guards in `planRepublish` (no index.html, or more
// than half the published files going, is an error). The dashboard's zip upload
// remains the other way to do the same.
// This is what lets the add-game skill use one code path for single-file and
// folder games instead of each growing its own `put()` loop.
//
// STAGED PUBLISHES (`--staged`). A staged game is visible only to beta testers
// until an admin presses Publish in the dashboard, so its files must never be
// anywhere the public can fetch them:
//   - the source is a folder OUTSIDE `public/` (`.staging/<slug>/`, gitignored),
//     and the script refuses a source under `public/` or a `public/games/<slug>/`
//     that already exists, because `public/` is served as static files at
//     guessable URLs and `sync-games` would carry the game out to it;
//   - the game's entry in games.ts carries `staged: true` (the add-game skill
//     writes it), which is what makes every public surface treat the slug as
//     unknown;
//   - `games_version` is NOT bumped, because nothing installed should refresh
//     for a game it cannot see. Publishing from the dashboard is what bumps it.
// `--cover <png>` uploads a tester-visible cover as a `hero` row in `game_media`
// and prints the `/game-media/...` path to put in the game's `coverUrl`. It is
// content-addressed (see `heroIdentity`), so re-running converges.
//
// Usage:
//   npm run publish-game -- <slug>                       # dry run: says what it would do
//   npm run publish-game -- <slug> --yes                 # actually writes
//   npm run publish-game -- <slug> --staged --from .staging/<slug> --cover cover.png [--yes]
//   npm run publish-game -- <slug> [--staged --from .staging/<slug>] --republish [--yes]
//
// Needs BLOB_READ_WRITE_TOKEN and DATABASE_URL, or a .env.local providing them.

import { neon } from "@neondatabase/serverless";
import { del, head, put } from "@vercel/blob";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyPublish,
  heroIdentity,
  isInsidePublic,
  parsePublishArgs,
  planRepublish,
  planUploads,
  readPngSize,
} from "./lib/publish-plan.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = parsePublishArgs(process.argv.slice(2));
const USAGE =
  "usage: npm run publish-game -- <slug> [--yes]\n" +
  "       npm run publish-game -- <slug> --staged --from .staging/<slug> [--cover <png>] [--yes]\n" +
  "       add --republish to update a bundle that is already published";
if (args.error) {
  console.error(`error: ${args.error}\n${USAGE}`);
  process.exit(1);
}
const { slug, staged } = args;
const confirmed = args.yes;

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

const publicDir = path.join(rootDir, "public");
const liveDir = path.join(publicDir, "games", slug);

// Where the game's files come from. Staged: the folder the caller named, which
// must be outside `public/`. Live: the mirror directory, as always.
let slugDir;
let displayDir;
if (staged) {
  slugDir = path.resolve(rootDir, args.from);
  displayDir = args.from;
  if (isInsidePublic(slugDir, publicDir)) {
    console.error(
      "error: a staged game's source must be OUTSIDE public/ — that directory is\n" +
        "       served as static files at guessable URLs, so a staged game there is\n" +
        "       public. Use .staging/<slug>/ (gitignored).",
    );
    process.exit(1);
  }
  // A leftover mirror directory is the same leak by another route, and a sign
  // the slug was published before: refuse rather than stage over a live game.
  if (existsSync(liveDir)) {
    console.error(
      `error: public/games/${slug}/ exists, so ${slug} is already (or was once) a\n` +
        "       live game and cannot be staged. Pick a different slug, or remove\n" +
        "       that directory if it is a leftover.",
    );
    process.exit(1);
  }
} else {
  slugDir = liveDir;
  displayDir = `public/games/${slug}`;
}
if (!existsSync(slugDir) || !statSync(slugDir).isDirectory()) {
  console.error(`error: no ${displayDir}/ to publish`);
  process.exit(1);
}

/** Every file under `dir`, as forward-slash paths relative to it. */
async function walk(dir, prefix = "") {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await walk(path.join(dir, entry.name), rel)));
    else found.push(rel);
  }
  return found;
}

const plan = planUploads(await walk(slugDir));
if (plan.errors.length > 0) {
  console.error(`error: ${displayDir}/ cannot be published:`);
  for (const e of plan.errors) console.error(`       - ${e}`);
  process.exit(1);
}

// Whether the game's index.html is already recorded decides whether a multi-file
// game is a safe (re)try of a first upload or a republish this script must
// refuse. Keyed on index.html, not on any row, so a half-finished first attempt
// does not block its own retry — see `classifyPublish`.
const indexRows = await sql`
  SELECT 1 FROM game_blobs WHERE pathname = ${`games/${slug}/index.html`} LIMIT 1
`;
const mode = classifyPublish(plan.uploads.length, indexRows.length > 0, args.republish);
if (mode === "refuse-bundle") {
  const extras = plan.uploads.map((u) => u.rel).filter((r) => r !== "index.html");
  console.error(
    `error: ${slug} is a multi-file bundle (${extras.join(", ")}) and already\n` +
      "       published. Pass --republish to update it (writes only the files that\n" +
      "       changed and deletes the ones the folder no longer has), or republish\n" +
      "       it through the dashboard. Without --republish this script only\n" +
      "       handles a lone index.html, or a bundle's FIRST upload (a retry of a\n" +
      "       half-finished first upload is fine).",
  );
  process.exit(1);
}

const files = [];
for (const u of plan.uploads) {
  const body = await readFile(path.join(slugDir, ...u.rel.split("/")));
  files.push({
    ...u,
    body,
    blobPath: `games/${slug}/${u.rel}`,
    hash: createHash("sha256").update(body).digest("hex").slice(0, 12),
    sha256: createHash("sha256").update(body).digest("hex"),
  });
}

// A republish: what the database says is published, read UNCACHED and straight
// from `game_blobs` (never a Blob `list()`, which is an advanced operation).
// Fingerprints are absent on a database migration 038 has not reached; the plan
// reads that as "write it", which is the old behaviour.
let republish = null;
if (mode === "bundle-republish") {
  let rows;
  try {
    rows = await sql`SELECT pathname, sha256 FROM game_blobs WHERE slug = ${slug}`;
  } catch (error) {
    const missingColumn =
      error?.code === "42703" || /column .* does not exist/i.test(error?.message ?? "");
    if (!missingColumn) throw error;
    rows = (await sql`SELECT pathname FROM game_blobs WHERE slug = ${slug}`).map((r) => ({
      ...r,
      sha256: null,
    }));
  }
  republish = planRepublish({
    slug,
    local: files.map((f) => ({ rel: f.rel, sha256: f.sha256 })),
    published: rows.map((r) => ({ pathname: String(r.pathname), sha256: r.sha256 ? String(r.sha256) : null })),
  });
  if (republish.error) {
    console.error(`error: cannot republish ${slug}: ${republish.error}.`);
    process.exit(1);
  }
}

// The staged flow's cover: validated up front like everything else, so a bad
// PNG fails the dry run rather than half-way through the uploads.
let hero = null;
if (args.cover) {
  const coverPath = path.resolve(rootDir, args.cover);
  if (!existsSync(coverPath)) {
    console.error(`error: --cover ${args.cover} does not exist`);
    process.exit(1);
  }
  const bytes = await readFile(coverPath);
  const size = readPngSize(bytes);
  if (!size) {
    console.error(`error: --cover ${args.cover} is not a PNG`);
    process.exit(1);
  }
  hero = { bytes, ...size, ...heroIdentity(slug, bytes) };
}

// What is live right now, so the operator can see what they are replacing.
// `head()` on the one path we care about rather than a `list()` of the prefix:
// head is a SIMPLE Blob operation (10,000/month) and list is an ADVANCED one
// (2,000/month), and this only ever wants a single known key. A miss means
// nothing is published yet, which is not an error. Only a lone index.html has
// anything to compare with; a bundle's first upload has no published copy.
const htmlFile = files.find((f) => f.rel === "index.html");
let live = null;
let liveHash = null;
if (mode === "single") {
  try {
    live = await head(htmlFile.blobPath);
  } catch {
    live = null;
  }
  if (live) {
    try {
      const res = await fetch(live.url, { cache: "no-store" });
      const body = Buffer.from(await res.arrayBuffer());
      liveHash = createHash("sha256").update(body).digest("hex").slice(0, 12);
    } catch {
      // Non-fatal: the comparison is a courtesy, not a gate.
    }
  }
}

console.log(`game:        ${slug}${staged ? "  (STAGED — beta testers only)" : ""}`);
console.log(`source:      ${displayDir}/`);
if (mode === "single") {
  console.log(`local:       ${htmlFile.body.length} bytes  sha256:${htmlFile.hash}`);
  console.log(
    live
      ? `published:   ${live.size} bytes  sha256:${liveHash ?? "unreadable"}  uploaded ${live.uploadedAt.toISOString()}`
      : "published:   (nothing yet — this would be the first upload)",
  );
} else if (republish) {
  console.log(
    `local:       ${files.length} files (republish: ${republish.write.length} to write, ` +
      `${republish.skip.length} unchanged, ${republish.stale.length} to delete)`,
  );
  for (const rel of republish.write) console.log(`  write      ${rel}`);
  for (const pathname of republish.stale) console.log(`  DELETE     ${pathname}`);
} else {
  console.log(`local:       ${files.length} files (first upload of a multi-file game)`);
  for (const f of files) console.log(`             ${f.rel}  ${f.body.length} bytes`);
}
if (hero) {
  console.log(`cover:       ${hero.width}x${hero.height} PNG → ${hero.publicPath}`);
}

// A lone index.html identical to what is live needs no write. A cover still
// does, which is why this only drops the HTML rather than exiting.
const identical = mode === "single" && liveHash && liveHash === htmlFile.hash;
const writeSet = republish ? new Set(republish.write) : null;
const toWrite = identical ? [] : writeSet ? files.filter((f) => writeSet.has(f.rel)) : files;
const toDelete = republish ? republish.stale : [];
if (toWrite.length === 0 && toDelete.length === 0 && !hero) {
  console.log("\nidentical — nothing to publish.");
  process.exit(0);
}
if (identical) console.log("\nindex.html is identical to what is live; only the cover is written.");

if (!confirmed) {
  const steps = [];
  if (toWrite.length > 0) {
    steps.push(
      toWrite.length === 1
        ? `overwrite ${toWrite[0].blobPath}`
        : `upload ${toWrite.length} files under games/${slug}/`,
    );
    steps.push("record it in game_blobs so the serving route can see it");
  }
  if (toDelete.length > 0) {
    steps.push(
      `delete ${toDelete.length} published file${toDelete.length === 1 ? "" : "s"} the folder no longer has, and forget their game_blobs rows (after every upload succeeded)`,
    );
  }
  if (hero) steps.push(`upload the cover to ${hero.blobPath} and add its hero row to game_media`);
  steps.push(
    staged
      ? "NOT bump games_version (staged: nothing installed should refresh)"
      : "bump games_version so installed clients refresh their cached copy",
  );
  console.log(
    "\nDRY RUN. Nothing was written. Re-run with --yes to publish, which will:\n" +
      steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n"),
  );
  process.exit(0);
}

// The same writes, with the same options, the dashboard's publish performs.
for (const f of toWrite) {
  const uploaded = await put(f.blobPath, f.body, {
    access: "public",
    contentType: f.contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
  console.log(`\npublished ${f.blobPath}`);

  // NOT best-effort, unlike the bump below: without this row the serving route
  // does not know the blob exists. Mirrors `recordGameBlobs()`, fingerprint
  // included — and that part is not optional either: the dashboard skips any
  // file whose bytes match the row's fingerprint (migration 038), so a row
  // still holding the dashboard's last one would make it skip re-publishing
  // those older bytes over this file, and say "No changes".
  const sha256 = createHash("sha256").update(f.body).digest("hex");
  try {
    await sql`
      INSERT INTO game_blobs (pathname, slug, url, size, uploaded_at, sha256)
      VALUES (${f.blobPath}, ${slug}, ${uploaded.url}, ${f.body.length}, now(), ${sha256})
      ON CONFLICT (pathname) DO UPDATE
        SET url = EXCLUDED.url, size = EXCLUDED.size, uploaded_at = EXCLUDED.uploaded_at,
            sha256 = EXCLUDED.sha256
    `;
  } catch (error) {
    // A database migration 038 has not reached: no column, so no fingerprint
    // to leave stale. Record the row the way it was recorded before.
    const missingColumn =
      error?.code === "42703" || /column .* does not exist/i.test(error?.message ?? "");
    if (!missingColumn) throw error;
    await sql`
      INSERT INTO game_blobs (pathname, slug, url, size, uploaded_at)
      VALUES (${f.blobPath}, ${slug}, ${uploaded.url}, ${f.body.length}, now())
      ON CONFLICT (pathname) DO UPDATE
        SET url = EXCLUDED.url, size = EXCLUDED.size, uploaded_at = EXCLUDED.uploaded_at
    `;
  }
  console.log("recorded in game_blobs");
}

// The sweep, AFTER every upload has succeeded (a failed `put` above exits the
// script, so a half-finished republish never deletes anything), and best-effort
// like the dashboard's: a leftover file is unreferenced, not fatal, and the next
// republish converges it. Blob first, then the rows, so a failed delete leaves
// rows that still describe real blobs rather than blobs nothing knows about.
if (toDelete.length > 0) {
  try {
    await del(toDelete);
    await sql`DELETE FROM game_blobs WHERE pathname = ANY(${toDelete}::text[])`;
    console.log(`\ndeleted ${toDelete.length} orphaned file${toDelete.length === 1 ? "" : "s"}`);
  } catch (error) {
    console.warn(
      `\nwarning: wrote the new files but could not delete the orphans: ${error.message}\n` +
        "         re-run with --republish to retry; they are unreferenced, not harmful.",
    );
  }
}

// The hero row. Under `game-media/`, never `games/` — see `game-media.sql` for
// the seven behaviours that sweep `games/` and would delete, mirror or precache
// a cover stored there. `kind = 'hero'` keeps it out of the gallery and its cap.
if (hero) {
  const uploaded = await put(hero.blobPath, hero.bytes, {
    access: "public",
    contentType: "image/png",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 31536000,
  });
  await sql`
    INSERT INTO game_media
      (id, slug, kind, blob_path, blob_url, content_type, width, height, bytes, alt)
    VALUES
      (${hero.id}, ${slug}, 'hero', ${hero.blobPath}, ${uploaded.url}, 'image/png',
       ${hero.width}, ${hero.height}, ${hero.bytes.length}, '')
    ON CONFLICT (id) DO UPDATE
      SET blob_url = EXCLUDED.blob_url, updated_at = now()
  `;
  console.log(`\ncover recorded in game_media: ${hero.publicPath}`);
  console.log(`put this in the game's games.ts entry:  coverUrl: "${hero.publicPath}",`);
}

if (staged) {
  // Deliberately skipped, not best-effort: a bump makes every online client
  // re-download the corpus for a game they cannot even see.
  console.log("\nskipped the games_version bump (staged game).");
} else {
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
}

// NOT REVALIDATED FROM HERE, and this is the one caveat worth knowing. The
// dashboard's publish path calls `updateTag(GAMES_BLOB_CACHE_TAG)` right after
// writing, so the new blob is visible on the very next request. A script cannot
// reach Next's data cache, so the deployed app keeps its cached read of the
// index until the TTL in `game-blob-index.ts` expires (1h). Redeploy to clear it
// sooner. The hero row inserted above is in the same position against the media
// cache, whose backstop is a DAY (`CATALOGUE_TTL_SECONDS` in
// `app/lib/cache-lifetimes.ts`); any media edit for the game on its dashboard
// page expires that cache at once.
console.log(
  "\nNote: the deployed app caches the blob index for up to an hour, so the\n" +
    "change may take that long to appear. Redeploy to clear it immediately.\n" +
    "The hero image can take up to a day to reach the game page; any media edit\n" +
    "for the game on its dashboard page shows it at once.",
);
