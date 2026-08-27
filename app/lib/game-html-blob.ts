/**
 * HallPass — pure path, type and policy helpers for a game's SOURCE blobs.
 *
 * Deliberately imports NOTHING: no `@vercel/blob`, no `server-only`, no database.
 * The route that streams the bytes, the dashboard actions that publish them, the
 * Neon index that remembers them and `scripts/sync-games.mjs` all funnel through
 * these helpers, and keeping them dependency-free is what lets every one of those
 * callers share them without dragging a blob client or a Neon connection along.
 *
 * The reads that used to live here (`listGameFiles`, `readPublishedIndexHtml`)
 * moved to `app/lib/game-blob-index.ts` when they stopped calling Blob and
 * started reading the Neon mirror — see that module for why.
 */

/** The one prefix every game-source blob lives under. */
export const GAMES_PREFIX = "games/";

export function blobPathForSlug(slug: string): string {
  return `games/${slug}/index.html`;
}

export function blobPrefixForSlug(slug: string): string {
  return `games/${slug}/`;
}

/**
 * The game a `games/<slug>/<rest>` blob key belongs to, or `null` when the key
 * names no game — anything outside the prefix, and anything sitting DIRECTLY
 * under it with no file after the slug (`games/version.txt`, the retired
 * sentinel, is exactly that shape).
 *
 * The slug is validated against the same lowercase format the `game_blobs`
 * table CHECKs and `game_overrides` uses, so an unexpected key is skipped by the
 * indexer rather than rejected by Postgres mid-upload.
 */
export function slugFromBlobPath(pathname: string): string | null {
  if (!pathname.startsWith(GAMES_PREFIX)) return null;
  const rest = pathname.slice(GAMES_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  const slug = rest.slice(0, slash);
  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : null;
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

/** One published file of a game, as the dashboard's source panel needs it. */
export type GameBlobFile = { pathname: string; size: number };
