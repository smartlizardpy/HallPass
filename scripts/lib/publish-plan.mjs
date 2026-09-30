// The pure half of `scripts/publish-game.mjs`: argument parsing, deciding which
// files of a game folder are uploaded, and reading a cover PNG. Everything that
// touches Blob or the database stays in the script; everything that can be
// decided from names and bytes lives here so it can be unit-tested without
// either (`app/lib/publish-plan.test.ts` — vitest only includes `app/**` and
// `sdk/**`, hence the location).
//
// It exists because the add-game skill now publishes THROUGH the script instead
// of running its own `put()` loop, and a loop the skill wrote inline was
// untestable and had already drifted from the dashboard's rules (content types,
// the path-segment cap). Anything a game folder can get wrong is checked here,
// before a single byte is uploaded.

import { createHash } from "node:crypto";

/** Files allowed to sit beside index.html without being uploaded as game source. */
export const REPO_ONLY_FILES = new Set(["cover.png"]);

// Duplicated from app/lib/game-html-blob.ts (the source of truth) — an .mjs
// script cannot import the TS module. Keep in sync, as `sync-games` does for
// `isSafeSegment`. A path that fails these is one the serving route refuses.
const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;
export const MAX_PATH_SEGMENTS = 10;
/** Sanity cap from the add-game skill's folder flow. */
export const MAX_FILES = 300;

/** @param {string} segment */
export function isSafeSegment(segment) {
  return segment.length <= 128 && SAFE_SEGMENT_RE.test(segment);
}

// Mirror of CONTENT_TYPES in app/lib/game-html-blob.ts.
const CONTENT_TYPES = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  wasm: "application/wasm",
  woff: "font/woff",
  woff2: "font/woff2",
};

/** @param {string} relPath */
export function contentTypeForPath(relPath) {
  const dot = relPath.lastIndexOf(".");
  const ext = dot === -1 ? "" : relPath.slice(dot + 1).toLowerCase();
  return /** @type {Record<string, string>} */ (CONTENT_TYPES)[ext] ??
    "application/octet-stream";
}

/**
 * @typedef {{
 *   slug: string | undefined,
 *   yes: boolean,
 *   staged: boolean,
 *   from: string | null,
 *   cover: string | null,
 *   error: string | null,
 * }} PublishArgs
 */

/**
 * Parse `<slug> [--yes] [--staged] [--from <dir>] [--cover <png>]`.
 *
 * `--from` and `--cover` take the NEXT argument, which is why the slug cannot be
 * "the first argument without a dash" any more: that would pick up the folder.
 * Flag values are consumed explicitly and the slug is the one positional left.
 *
 * @param {string[]} argv
 * @returns {PublishArgs}
 */
export function parsePublishArgs(argv) {
  /** @type {PublishArgs} */
  const out = {
    slug: undefined,
    yes: false,
    staged: false,
    from: null,
    cover: null,
    error: null,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--yes") out.yes = true;
    else if (a === "--staged") out.staged = true;
    else if (a === "--from" || a === "--cover") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        out.error = `${a} needs a path`;
        return out;
      }
      if (a === "--from") out.from = value;
      else out.cover = value;
      i += 1;
    } else if (a.startsWith("-")) {
      out.error = `unknown option ${a}`;
      return out;
    } else positional.push(a);
  }
  if (positional.length > 1) {
    out.error = `expected one slug, got ${positional.join(" ")}`;
    return out;
  }
  out.slug = positional[0];
  if (!out.slug || !/^[a-z0-9][a-z0-9-]*$/.test(out.slug)) {
    out.error = "a lowercase-kebab slug is required";
  } else if (out.cover && !out.staged) {
    // A live game's cover is `public/games/<slug>/cover.png` in the repo. A hero
    // media row is the staged flow's cover, which has no repo copy to use.
    out.error = "--cover is only for --staged publishes";
  } else if (out.from && !out.staged) {
    out.error = "--from is only for --staged publishes (a live game is read from public/games/<slug>/)";
  } else if (out.staged && !out.from) {
    // Staged files must never sit in `public/games/`, so there is no sensible
    // default source. Making the caller say where they are keeps that explicit.
    out.error = "--staged needs --from .staging/<slug>";
  }
  return out;
}

/**
 * What a staged game's source directory must not be: anything under
 * `public/`. `public/` is served as static files at guessable URLs, so a staged
 * game living there is public regardless of what the routes gate.
 *
 * @param {string} resolvedFrom absolute path of the source directory
 * @param {string} resolvedPublic absolute path of the repo's public/ directory
 */
export function isInsidePublic(resolvedFrom, resolvedPublic) {
  const rel = resolvedFrom.slice(resolvedPublic.length);
  return (
    resolvedFrom === resolvedPublic ||
    (resolvedFrom.startsWith(resolvedPublic) && /^[/\\]/.test(rel))
  );
}

/**
 * Decide which files of a game folder are uploaded, and reject a folder the
 * serving route could not serve.
 *
 * @param {string[]} relPaths forward-slash paths relative to the game root
 * @returns {{
 *   uploads: { rel: string, contentType: string }[],
 *   errors: string[],
 * }}
 */
export function planUploads(relPaths) {
  /** @type {string[]} */
  const errors = [];
  const uploads = [];
  for (const rel of [...relPaths].sort()) {
    if (REPO_ONLY_FILES.has(rel)) continue;
    const segments = rel.split("/");
    if (segments.length > MAX_PATH_SEGMENTS) {
      errors.push(`${rel}: deeper than ${MAX_PATH_SEGMENTS} path segments`);
    } else if (!segments.every(isSafeSegment)) {
      errors.push(`${rel}: a path segment is not blob-route safe`);
    } else {
      uploads.push({ rel, contentType: contentTypeForPath(rel) });
    }
  }
  if (!uploads.some((u) => u.rel === "index.html")) {
    errors.push("index.html is missing from the game root");
  }
  if (uploads.length > MAX_FILES) {
    errors.push(`${uploads.length} files exceeds the ${MAX_FILES}-file cap`);
  }
  return { uploads, errors };
}

/**
 * How to treat a folder, given whether the slug is already published.
 *
 * "Published" means its `games/<slug>/index.html` row exists in `game_blobs`,
 * NOT that the slug has any row at all. Uploads write index.html in sorted
 * order after other files, so a first attempt that died half-way leaves rows for
 * its assets but none for index.html; counting those would wedge the retry
 * behind a refusal it could never clear. A game with no index.html blob was
 * never live, so there is nothing a retry can orphan and overwriting is safe.
 *
 *  - `single`        only index.html: the long-standing publish
 *  - `bundle-first`  several files and no published index.html: safe, because
 *                    there is no live game whose files a retry could orphan
 *  - `refuse-bundle` several files over a published game: a republish must
 *                    also delete the files the new upload orphans, which only
 *                    the dashboard does (see `writeGameHtml`); getting it wrong
 *                    deletes a live game's assets
 *
 * @param {number} fileCount uploads, excluding repo-only files
 * @param {boolean} indexPublished a `games/<slug>/index.html` row exists
 * @returns {"single" | "bundle-first" | "refuse-bundle"}
 */
export function classifyPublish(fileCount, indexPublished) {
  if (fileCount <= 1) return "single";
  return indexPublished ? "refuse-bundle" : "bundle-first";
}

/**
 * Read width and height from a PNG's IHDR chunk, or `null` if the bytes are not
 * a PNG. Same byte arithmetic as `readImageMeta` in app/lib/image-meta.ts.
 *
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number } | null}
 */
export function readPngSize(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !sig.every((b, i) => bytes[i] === b)) return null;
  // The first chunk must be IHDR ("IHDR" at offset 12), else the header is bogus.
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Identity of a hero (cover) media row for these bytes.
 *
 * Content-addressed, so re-running the publish with the same screenshot lands on
 * the same id, blob key and URL and converges instead of accumulating rows, and a
 * NEW screenshot gets a new URL — which matters because the media route serves
 * `Cache-Control: immutable`, so an overwritten key would never refresh.
 *
 * @param {string} slug
 * @param {Uint8Array} bytes
 * @returns {{ id: string, blobPath: string, publicPath: string }}
 */
export function heroIdentity(slug, bytes) {
  const id = `hero-${createHash("sha256").update(bytes).digest("hex").slice(0, 10)}`;
  const blobPath = `game-media/${slug}/${id}.png`;
  return { id, blobPath, publicPath: `/${blobPath}` };
}
