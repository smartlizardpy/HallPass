import { list, head } from "@vercel/blob";

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
 * The current published `index.html` for a game, as a string — or `null` when
 * the game is still on the build default (no custom blob for it).
 *
 * This is the READ side of the source-code panel, whose only affordance until now
 * was upload. The integration loop is: copy the live code out, add the scoreboard
 * and achievement calls, publish it back. Without this, step one meant hunting
 * for a blob URL by hand.
 *
 * Blob is the source of truth for a published game, so it is read directly rather
 * than through the serving route. `cache: "no-store"` because an admin who just
 * uploaded expects to copy exactly what they uploaded, not a cached prior version.
 * Fails soft to `null`: a missing file or a blob hiccup means "nothing to copy",
 * never a broken dashboard.
 */
export async function readPublishedIndexHtml(slug: string): Promise<string | null> {
  try {
    const meta = await head(blobPathForAsset(slug, "index.html"));
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
