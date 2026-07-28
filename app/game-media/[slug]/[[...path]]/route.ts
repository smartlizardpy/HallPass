/**
 * Serves game screenshots from Vercel Blob on OUR origin.
 *
 * Structurally a sibling of `app/game-html/[slug]/[[...path]]/route.ts`, and it
 * reuses that module's `isSafeSegment` path guard. Three differences are
 * deliberate and should not be "unified" away:
 *
 * 1. THE SLUG IS VALIDATED AGAINST THE RESOLVED CATALOGUE, NOT THE STATIC ARRAY.
 *    `/game-html/` correctly 404s external-game slugs, because an off-site game
 *    has no bundled source to serve. Media is the exact opposite case: an
 *    external game has no `cover.png` of its own, so it is the kind of game that
 *    most needs uploaded screenshots. Hence `isResolvedSlug` (static + overrides
 *    + external) rather than `games.some(...)`.
 *
 * 2. A MISSING OBJECT IS A 404, NOT A 307 TO A STATIC TWIN. There is no
 *    `public/` mirror for media — nothing writes one, and nothing should, since
 *    `build-sw-manifest.mjs` would then precache every game's screenshots onto
 *    every visitor's device at install time.
 *
 * 3. `immutable` CACHING. Media ids are random and blobs are written with
 *    `allowOverwrite: false`, so a given URL's bytes never change; editing a
 *    gallery mints new URLs rather than rewriting old ones.
 *
 * Why serve through our origin at all instead of linking the Blob URL directly:
 * `public/sw.js` returns early for cross-origin requests, and its `isCacheable`
 * requires a `basic`/`default` response type, so a raw Blob URL can never enter
 * the service-worker cache. Same-origin puts these in the `cacheFirst` branch,
 * which is what makes a game's screenshots survive going offline.
 */

import { head } from "@vercel/blob";
import { isSafeSegment } from "@/app/lib/game-html-blob";
import { isResolvedSlug } from "@/app/lib/games-store";
import { getMediaByBlobPath, mediaBlobPrefix } from "@/app/lib/game-media";

/** Media is always `<slug>/<id>.<ext>` — one segment. Anything else is a probe. */
const MAX_PATH_SEGMENTS = 1;

const NOT_FOUND = () => new Response("Not found", { status: 404 });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path } = await params;

  const segments = path ?? [];
  if (
    segments.length === 0 ||
    segments.length > MAX_PATH_SEGMENTS ||
    !segments.every(isSafeSegment)
  ) {
    return NOT_FOUND();
  }

  // Catalogue membership is checked before any I/O so an unknown slug costs one
  // cache hit rather than a Blob round trip.
  if (!(await isResolvedSlug(slug))) return NOT_FOUND();

  const blobPath = `${mediaBlobPrefix(slug)}${segments[0]}`;

  // The DB row is the authority on what is servable, not the URL. Without this
  // the route would happily stream ANY object that happens to live under the
  // media prefix, including one whose row was deleted but whose blob delete
  // failed. It also gives us the stored content type, so the response never has
  // to sniff or trust the extension.
  let media = null;
  try {
    media = await getMediaByBlobPath(blobPath);
  } catch {
    // Database unreachable: fail closed. Serving unverified bytes from a
    // user-supplied path is not a safe degradation.
    return NOT_FOUND();
  }
  if (!media) return NOT_FOUND();

  let meta: { url: string } | null = null;
  try {
    meta = await head(blobPath);
  } catch {
    meta = null;
  }
  if (!meta) return NOT_FOUND();

  const upstream = await fetch(meta.url, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) return NOT_FOUND();

  return new Response(upstream.body, {
    status: 200,
    headers: {
      // The stored, sniffed-at-upload type — never derived from the URL.
      "content-type": media.contentType,
      "content-disposition": "inline",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
