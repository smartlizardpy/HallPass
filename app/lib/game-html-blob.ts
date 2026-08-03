import { list, head } from "@vercel/blob";
import { SITE_URL } from "@/app/lib/site";

export function blobPathForSlug(slug: string): string {
  return `games/${slug}/index.html`;
}

export function blobPrefixForSlug(slug: string): string {
  return `games/${slug}/`;
}

export function blobPathForAsset(slug: string, relPath: string): string {
  return `${blobPrefixForSlug(slug)}${relPath}`;
}

// One URL path segment of a game asset. The leading-alphanumeric requirement
// bars ".", "..", dotfiles and empty segments; the character class bars "/",
// "\" and control chars. Route params arrive percent-DECODED from Next's
// router, so encoded traversal ("%2e%2e", "%2f", "%5c") lands here as the
// literal characters and is rejected by the same allowlist.
const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

export function isSafeSegment(segment: string): boolean {
  return segment.length <= 128 && SAFE_SEGMENT_RE.test(segment);
}

const CONTENT_TYPES: Record<string, string> = {
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

export function contentTypeForPath(relPath: string): string {
  const dot = relPath.lastIndexOf(".");
  const ext = dot === -1 ? "" : relPath.slice(dot + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * One blob under a game's prefix, as the serving route needs it: enough to serve
 * the bytes (`url`) and to judge freshness against the deployed static mirror
 * (`uploadedAt`, epoch ms — a number, not a `Date`, so the cached list is
 * serialisable).
 */
export type ServingBlob = { url: string; uploadedAt: number };

/** What the game-serving route should do with one requested asset. */
export type GameSource =
  | { kind: "static" }
  | { kind: "proxy"; url: string };

/**
 * Decide whether a requested game asset should be served from the free
 * `public/games/` CDN twin or proxied byte-for-byte from Vercel Blob.
 *
 * This is the whole point of the blob-limits work, so the reasoning is here, in
 * one pure function, rather than smeared through the route:
 *
 * Vercel Blob is the LIVE copy — an admin upload lands there and must serve
 * immediately. `public/games/<slug>/` is the SAME bytes baked into the deploy by
 * `scripts/sync-games.mjs`, served for free off Vercel's CDN. `mirrorSyncedAt` is
 * when that mirror was captured. So a blob whose `uploadedAt` is at or before the
 * mirror stamp is already in the deploy and costs nothing to serve statically;
 * only a blob uploaded SINCE the last sync is genuinely newer than the mirror and
 * has to be proxied so the edit is live. Once the next sync+deploy bakes it in,
 * it falls back to the free path automatically.
 *
 * `staticExists` guards the one case that would otherwise 404: a game that lives
 * ONLY in Blob (uploaded but never mirrored into the repo — `sync-games` skips
 * slugs with no `public/games/<slug>/` dir). Such an asset is not newer than the
 * mirror yet has no static twin, so it must still be proxied. When neither a blob
 * nor a static twin exists we redirect to the static path anyway and let the CDN
 * answer 404 — exactly what the old `head()`-fails branch did.
 */
export function chooseGameSource(args: {
  staticExists: boolean;
  blob: ServingBlob | null;
  mirrorSyncedAt: number;
}): GameSource {
  const { staticExists, blob, mirrorSyncedAt } = args;
  if (blob && blob.uploadedAt > mirrorSyncedAt) return { kind: "proxy", url: blob.url };
  if (staticExists) return { kind: "static" };
  if (blob) return { kind: "proxy", url: blob.url };
  return { kind: "static" };
}

export type GameBlobFile = { pathname: string; size: number };

// `list()` results carry no contentType (only `head()` does) — callers must
// key decisions on pathname alone.
export async function listGameFiles(slug: string): Promise<GameBlobFile[]> {
  const files: GameBlobFile[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: blobPrefixForSlug(slug), cursor });
    for (const blob of page.blobs) {
      files.push({ pathname: blob.pathname, size: blob.size });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return files;
}


/**
 * The current `index.html` for a game, as a string — or `null` only when neither
 * a published blob nor a baked-in static copy can be read.
 *
 * This is the READ side of the source-code panel. The integration loop is: copy
 * the live code out, add the scoreboard and achievement calls, publish it back.
 *
 * TWO SOURCES, latest-first:
 *  1. The published blob (`games/<slug>/index.html`). When present it is the
 *     freshest copy — an upload lands here before anything else — so it is read
 *     directly and `no-store`, so an admin who just published copies exactly what
 *     they uploaded rather than a cached prior version.
 *  2. FALLBACK: the source baked into the deploy at `public/games/<slug>/`. This
 *     is what a build-default game (never published, or reset to default) is
 *     actually running, so it must be copyable too — otherwise that game's panel
 *     has nothing to copy and the integration loop can't start. Read over HTTP,
 *     not the filesystem: `public/` is served by the CDN and is not reliably
 *     present in the serverless function's working directory on Vercel. Since the
 *     static twin is a mirror of the blob at sync time, the blob (when present)
 *     is always at least as new, so blob-first is also latest-first.
 *
 * Fails soft to `null` at every step: a missing file or a hiccup means "nothing
 * to copy", never a broken dashboard.
 */
export async function readPublishedIndexHtml(slug: string): Promise<string | null> {
  try {
    const meta = await head(blobPathForAsset(slug, "index.html"));
    const res = await fetch(meta.url, { cache: "no-store" });
    if (res.ok) return await res.text();
  } catch {
    // No blob (build default / reset), or a transient blob error — fall back to
    // the static twin below rather than reporting "nothing to copy".
  }
  try {
    const res = await fetch(`${SITE_URL}/games/${slug}/index.html`, {
      cache: "no-store",
    });
    if (res.ok) return await res.text();
  } catch {
    // Network hiccup reaching the static twin.
  }
  return null;
}
