/**
 * HallPass — the games-version poll endpoint.
 *
 * Answers `{ version }`, where the version is the `uploadedAt` of the
 * `games/version.txt` sentinel. `app/components/PWA.tsx` polls this every 30s
 * and forwards the value to the service worker, which re-fetches every cached
 * `/game-html/` entry when it moves.
 *
 * THE RESPONSE STAYS UNCACHED, THE BLOB LOOKUP DOES NOT. Clients must never be
 * served a stale version from an HTTP cache — that is the whole point of the
 * poll — so the response keeps `no-store`. But the `head()` behind it is a
 * BILLED Vercel Blob simple operation, and one per poll per client is what took
 * 95% of the monthly allowance (see `GAMES_VERSION_CACHE_TAG` for the numbers).
 * Caching the lookup decouples Blob cost from traffic while leaving the
 * client-facing contract byte-identical.
 *
 * FAIL-SOFT, BUT NOT INSIDE THE CACHE. The try/catch lives at the CALL SITE, not
 * in the cached primitive: `unstable_cache` only stores a FULFILLED result, so a
 * transient Blob failure MUST reject here. Swallowing it into a `"0"` would
 * cache that `"0"` for the full TTL and tell every client the games had been
 * rolled back — the same argument written up in `game-serving-blobs.ts`.
 */

import { head } from "@vercel/blob";
import { unstable_cache } from "next/cache";
import {
  GAMES_VERSION_BLOB_PATH,
  GAMES_VERSION_CACHE_TAG,
} from "@/app/lib/games-version-blob";

export const dynamic = "force-dynamic";

/**
 * How long a sentinel lookup may be reused, in seconds.
 *
 * Correctness does not depend on this value: `bumpGamesVersion()` revalidates
 * {@link GAMES_VERSION_CACHE_TAG} straight after writing the blob, so a real
 * upload is picked up on the next poll. An hour is the backstop for a blob
 * written out-of-band, and caps the spend at 24 operations/day.
 */
const VERSION_TTL_SECONDS = 3600;

/**
 * THROWS on failure by design — see the fail-soft note in the module docblock.
 * Returns a string so the value is trivially JSON-serialisable into the data
 * cache.
 */
const readVersionCached = unstable_cache(
  async (): Promise<string> => {
    const meta = await head(GAMES_VERSION_BLOB_PATH);
    return String(meta.uploadedAt.getTime());
  },
  ["games-version-sentinel"],
  { tags: [GAMES_VERSION_CACHE_TAG], revalidate: VERSION_TTL_SECONDS },
);

export async function GET() {
  let version = "0";
  try {
    version = await readVersionCached();
  } catch {
    // No version blob yet, or Blob is unreachable — fall through to "0". The
    // service worker treats an unchanged version as "nothing to do", so this
    // degrades to no refresh rather than to a spurious one.
  }
  return Response.json(
    { version },
    {
      headers: { "cache-control": "no-store, must-revalidate" },
    },
  );
}
