/**
 * Path rules for files inside an `.hpg` package.
 *
 * Paths come from untrusted archives, so they are validated by WHITELIST, not
 * by searching for bad sequences: each `/`-separated segment must start with a
 * letter or digit and contain only `A-Z a-z 0-9 . _ -`. That single rule
 * excludes `..`, `.`, empty segments (`a//b`, leading or trailing `/`),
 * absolute paths, backslashes, drive letters (`C:`), NUL and every other
 * control or Unicode trick, without enumerating them.
 *
 * Paths are case-sensitive inside a package, but two paths that differ only in
 * case are rejected as duplicates ({@link pathKey}): extracted on a
 * case-insensitive file system (Windows, default macOS) they would collide.
 */

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const MAX_PATH_LENGTH = 200;
export const MAX_SEGMENT_LENGTH = 100;
export const MAX_PATH_DEPTH = 8;

export function isSafePackagePath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  const segments = path.split("/");
  if (segments.length > MAX_PATH_DEPTH) return false;
  return segments.every(
    (s) => s.length <= MAX_SEGMENT_LENGTH && SEGMENT_RE.test(s),
  );
}

/** The key two paths collide on when extracted to a case-insensitive disk. */
export function pathKey(path: string): string {
  return path.toLowerCase();
}

/** The lowercase extension including the dot (`".png"`), or `""`. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".txt": "text/plain",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
};

/** The media type a package file is served with inside the game frame. */
export function mimeTypeOf(path: string): string {
  return MIME_BY_EXTENSION[extensionOf(path)] ?? "application/octet-stream";
}

export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
]);
