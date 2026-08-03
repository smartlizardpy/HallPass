/**
 * HallPass — the cached view of `games/**` in Vercel Blob that the game-serving
 * route reads on every request.
 *
 * WHY THIS EXISTS. The route used to call `head(games/<slug>/<file>)` on EVERY
 * request for EVERY asset of EVERY game — one Blob operation per file per play.
 * A single multi-file game loading its bundle could fire a dozen `head()`s, and
 * every returning player re-fired them, which is what pushed the Blob store into
 * its operations limit. This module collapses all of that into ONE cached
 * `list()` over the whole `games/` prefix, shared across every request and every
 * asset until it is invalidated. `list()` already returns each blob's `url` and
 * `uploadedAt`, so the route needs nothing else from Blob — no per-asset `head()`
 * at all.
 *
 * INVALIDATION. The list is tagged {@link GAMES_BLOB_CACHE_TAG}. Every source
 * mutation (`uploadHtmlAction`, `pasteHtmlAction`, `uploadBundleAction`,
 * `clearHtmlAction`) MUST `revalidateTag(GAMES_BLOB_CACHE_TAG, { expire: 0 })`
 * after writing, so an admin's upload appears in the next serve with
 * read-your-writes semantics rather than waiting out the soft TTL.
 *
 * FAIL-SOFT. Like `readOverrides`/`getAllGameMedia`, the try/catch lives at the
 * CALL SITE, not inside the cached primitive: `unstable_cache` only stores a
 * FULFILLED result, so a transient Blob blip must reject here — otherwise an
 * empty list would be cached under the tag for the full TTL and every game would
 * lose its blob copy until something invalidated it. On failure the route reads
 * an empty map, which degrades to serving the baked-in static twin — the same
 * degradation the old `head()`-fails branch produced.
 */

import "server-only";
import { list } from "@vercel/blob";
import { unstable_cache } from "next/cache";
import type { ServingBlob } from "@/app/lib/game-html-blob";

/** All game blobs live under this one prefix; one `list()` covers every game. */
const GAMES_PREFIX = "games/";

/**
 * Cache tag for {@link getServingBlobMap}. Re-exported so the source-editing
 * actions can invalidate it without re-declaring the literal.
 */
export const GAMES_BLOB_CACHE_TAG = "games-serving-blobs";

type ServingBlobEntry = { pathname: string } & ServingBlob;

/**
 * THROWS on failure by design — see the fail-soft note in the module docblock.
 * Paginates the whole `games/` prefix; `uploadedAt` is flattened to epoch ms so
 * the array is JSON-serialisable into the data cache.
 */
const listServingBlobsCached = unstable_cache(
  async (): Promise<ServingBlobEntry[]> => {
    const entries: ServingBlobEntry[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: GAMES_PREFIX, cursor });
      for (const blob of page.blobs) {
        entries.push({
          pathname: blob.pathname,
          url: blob.url,
          uploadedAt: blob.uploadedAt.getTime(),
        });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return entries;
  },
  ["games-serving-blobs"],
  { tags: [GAMES_BLOB_CACHE_TAG], revalidate: 60 },
);

/**
 * Every game blob keyed by its full pathname (`games/<slug>/<file>`). Fail-soft
 * to an EMPTY map, which the route reads as "no live blob" and answers from the
 * static twin. The key matches {@link blobPathForAsset} so the route can look up
 * an asset directly.
 */
export async function getServingBlobMap(): Promise<Map<string, ServingBlob>> {
  let entries: ServingBlobEntry[];
  try {
    entries = await listServingBlobsCached();
  } catch {
    return new Map();
  }
  const map = new Map<string, ServingBlob>();
  for (const { pathname, url, uploadedAt } of entries) {
    map.set(pathname, { url, uploadedAt });
  }
  return map;
}
