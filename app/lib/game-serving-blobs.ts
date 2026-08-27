/**
 * HallPass — the view of `games/**` that the game-serving route reads on every
 * request.
 *
 * WHY THIS EXISTS. The route used to call `head(games/<slug>/<file>)` on EVERY
 * request for EVERY asset of EVERY game — one Blob operation per file per play.
 * A single multi-file game loading its bundle could fire a dozen `head()`s, and
 * every returning player re-fired them, which is what pushed the Blob store into
 * its operations limit. This module collapses all of that into ONE lookup of the
 * whole `games/` prefix, shared across every request and every asset.
 *
 * THAT LOOKUP USED TO BE A `list()`, AND IS NOW A DATABASE READ. `list()` is a
 * BILLED Vercel Blob ADVANCED operation, the Hobby allowance for those is 2,000
 * a month (a twentieth of the simple-operation budget), and this one listing
 * measured 920 of 934 advanced operations over 30 days — 98% of everything the
 * site spent, and ~46% of the entire monthly allowance. It also PAGINATED, so a
 * single refresh could be several operations.
 *
 * Caching it made the cost scale with time instead of traffic; it did not make
 * the cost zero, and "zero" is what an allowance at 100% requires. So the map is
 * now built from `game_blobs`, the Neon mirror every writer of a `games/**` blob
 * updates in the same action — see `app/lib/game-blob-index.ts` for the
 * invariant and `app/lib/blob-index.sql` for the numbers. Serving a game now
 * costs NO Blob operation at all, however many assets it loads and however many
 * times it is played.
 *
 * FAIL-SOFT is unchanged and still lives one layer down, in
 * `readGameBlobIndex()`: on any failure the route reads an empty map, which
 * degrades to serving the baked-in static twin — the same degradation the
 * original `head()`-fails branch produced.
 */

import "server-only";
import {
  GAMES_BLOB_CACHE_TAG,
  readGameBlobIndex,
} from "@/app/lib/game-blob-index";
import type { ServingBlob } from "@/app/lib/game-html-blob";

/**
 * Cache tag for the index read.
 *
 * Re-exported from `game-blob-index.ts`, which now owns it, so the four
 * source-mutating actions keep invalidating through the import site they already
 * have. Every source mutation MUST `updateTag(GAMES_BLOB_CACHE_TAG)` after
 * writing, so an admin's upload appears in the next serve with read-your-writes
 * semantics rather than waiting out the soft TTL.
 */
export { GAMES_BLOB_CACHE_TAG };

/**
 * Every game blob keyed by its full pathname (`games/<slug>/<file>`). Fail-soft
 * to an EMPTY map, which the route reads as "no live blob" and answers from the
 * static twin. The key matches `blobPathForAsset` so the route can look up an
 * asset directly.
 */
export async function getServingBlobMap(): Promise<Map<string, ServingBlob>> {
  const map = new Map<string, ServingBlob>();
  for (const { pathname, url, uploadedAt } of await readGameBlobIndex()) {
    map.set(pathname, { url, uploadedAt });
  }
  return map;
}
