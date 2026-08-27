/**
 * HallPass — the Neon mirror of the `games/**` Vercel Blob prefix.
 *
 * See `app/lib/blob-index.sql` for the table and the numbers behind it. The
 * short version: `list()` is a BILLED Vercel Blob ADVANCED operation (Hobby
 * allowance 2,000/month, a twentieth of the simple-operation budget), listing
 * `games/**` was 98% of every advanced operation this site spent, and when that
 * allowance runs out `put()` fails too — so the whole publishing surface dies
 * with it. This module is what replaces the listing.
 *
 * ── THE INVARIANT ───────────────────────────────────────────────────────────
 * WHATEVER WRITES A `games/**` BLOB RECORDS IT HERE, IN THE SAME ACTION.
 * WHATEVER DELETES ONE FORGETS IT HERE, IN THE SAME ACTION.
 *
 * The writers, exhaustively, as of this commit:
 *   - `uploadHtmlAction` / `pasteHtmlAction` (`dashboard/games/actions.ts`)
 *   - `uploadBundleAction` / `clearHtmlAction` (same file)
 *   - `cacheCoverToBlob` (`dashboard/external-games/actions.ts`)
 *   - `scripts/publish-game.mjs`, which writes out-of-band and therefore CANNOT
 *     record anything — see the reindex note below.
 *
 * ── WHY GETTING IT WRONG IS A DEGRADATION, NOT A BREAKAGE ───────────────────
 * A blob missing from this index reads as "this game has no override", and
 * `chooseGameSource()` answers that from the baked-in `public/games/` twin. That
 * is the same fail-soft the old `head()`-fails branch had, and the state every
 * game is in between a `sync-games` run and the next upload. So an index that
 * has drifted serves slightly stale bytes; it does not 404 and it does not
 * corrupt anything. That is what makes a lazily-rebuilt mirror an acceptable
 * substitute for asking the object store.
 *
 * ── RECONCILIATION ──────────────────────────────────────────────────────────
 * {@link reindexGameBlobs} spends ONE deliberate `list()` sweep to rebuild the
 * table from the store. It is the only `list()` left in the application, it is
 * never on a request path, and it is behind a super-admin button on
 * `/dashboard/blob`. Use it after deploying the migration, after running
 * `publish-game.mjs`, or after editing a blob in the Vercel dashboard.
 *
 * ── CACHING AND FAIL-SOFT ───────────────────────────────────────────────────
 * The full-table read stays behind `unstable_cache` even though it is now a
 * cheap Neon query: the serving route hits it for every asset of every play, the
 * tag plumbing (`GAMES_BLOB_CACHE_TAG`) and its `updateTag` call sites already
 * exist, and a database round trip per asset would be a worse trade than the one
 * we just removed. As everywhere else in this codebase the try/catch lives at
 * the CALL SITE, not inside the cached primitive: `unstable_cache` only stores a
 * FULFILLED result, so a transient failure MUST reject or an empty list gets
 * cached under the tag for the full TTL and every game loses its override.
 */

import "server-only";
import { list } from "@vercel/blob";
import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";
import {
  GAMES_PREFIX,
  blobPathForSlug,
  slugFromBlobPath,
  type GameBlobFile,
} from "@/app/lib/game-html-blob";
import { SITE_URL } from "@/app/lib/site";

/**
 * Cache tag for {@link readGameBlobIndex}. Owned here rather than in
 * `game-serving-blobs.ts` because this module is now the source of truth; that
 * module re-exports it so the existing `updateTag` call sites keep compiling
 * against the name they already import.
 */
export const GAMES_BLOB_CACHE_TAG = "games-serving-blobs";

/**
 * How long the index read may be reused, in seconds.
 *
 * Correctness does not depend on it: every mutator funnels through
 * `bumpGamesVersion()`, which `updateTag`s this tag with read-your-writes
 * semantics straight after writing. The TTL is only a backstop for rows written
 * by another deployment or by `reindexGameBlobs()` running elsewhere. An hour
 * was the right answer when a refresh cost a paginated `list()`; it stays an
 * hour now because nothing about the read path wants to be more eager.
 */
const INDEX_TTL_SECONDS = 3600;

/** One indexed blob, exactly as the table stores it. */
export type GameBlobRow = {
  pathname: string;
  slug: string;
  url: string;
  size: number;
  /** Epoch ms — a number, not a `Date`, so the cached array is serialisable. */
  uploadedAt: number;
};

type Row = Record<string, unknown>;

/** Postgres INTEGER arrives as a JS number; be defensive about NULL/strings. */
function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapRow(row: Row): GameBlobRow {
  return {
    pathname: String(row.pathname),
    slug: String(row.slug),
    url: String(row.url),
    size: toInt(row.size),
    uploadedAt: new Date(String(row.uploaded_at)).getTime(),
  };
}

/**
 * THROWS on failure by design — see the fail-soft note in the module docblock.
 *
 * Reads the WHOLE table in one query and lets callers filter in JS, the same
 * shape as `readOverrides()` and `readAllMediaCached()`. The table is bounded by
 * the corpus (a few hundred rows for a few dozen games), and one cache entry
 * under one tag is far simpler to invalidate than N per-slug entries — a
 * per-slug `unstable_cache` would also key on a runtime argument and grow an
 * unbounded number of entries.
 */
const readGameBlobIndexCached = unstable_cache(
  async (): Promise<GameBlobRow[]> => {
    const rows = await sql`
      SELECT pathname, slug, url, size, uploaded_at
      FROM game_blobs
      ORDER BY pathname ASC
    `;
    return rows.map(mapRow);
  },
  ["game-blob-index"],
  { tags: [GAMES_BLOB_CACHE_TAG], revalidate: INDEX_TTL_SECONDS },
);

/** Every indexed blob. Fail-soft to `[]` — see the module docblock. */
export async function readGameBlobIndex(): Promise<GameBlobRow[]> {
  try {
    return await readGameBlobIndexCached();
  } catch {
    return [];
  }
}

/** One game's indexed blobs, in path order. Fail-soft to `[]`. */
export async function readGameBlobsForSlug(slug: string): Promise<GameBlobRow[]> {
  return (await readGameBlobIndex()).filter((row) => row.slug === slug);
}

/**
 * Every published file of one game, for the dashboard's source panel and for
 * the stale-asset sweep the bundle/single-file publishers run.
 *
 * USED TO BE A PER-SLUG `list()` — one billed advanced operation per dashboard
 * page view and three more per publish. It is now a filter over the shared
 * cached index, which also fixes a latent bug in the old version: it took only
 * the first page of results in some call paths, so a game past the page size
 * would silently lose assets from the sweep.
 *
 * The convergence invariant the publishers rely on ("whatever this action
 * publishes IS the published set") is therefore now only as complete as the
 * index. A blob written out-of-band is not swept — it is also not visible to
 * the serving route, so the two agree with each other; `reindexGameBlobs()` is
 * what makes both see it again.
 */
export async function listGameFiles(slug: string): Promise<GameBlobFile[]> {
  return (await readGameBlobsForSlug(slug)).map(({ pathname, size }) => ({
    pathname,
    size,
  }));
}

/**
 * The same list, read UNCACHED, for the source mutators' stale-asset sweep.
 *
 * The cached read is right for the serving route and the dashboard, where a
 * slightly old answer costs a slightly old chip. It is wrong here: the sweep
 * decides which blobs to DELETE, and a cache entry that predates the previous
 * publish would either miss assets that should go (they survive until the next
 * publish — merely untidy) or name assets that are already gone (a `del()` of a
 * missing key, harmless, plus a no-op row delete). One extra Neon round trip on
 * an action a human is waiting on is cheaper than reasoning about either.
 *
 * THROWS on failure; the mutators run it inside the `try` that already treats
 * cleanup as best-effort, never inside the one guarding the `put`.
 */
export async function listGameFilesLive(slug: string): Promise<GameBlobFile[]> {
  const rows = await sql`
    SELECT pathname, size FROM game_blobs WHERE slug = ${slug} ORDER BY pathname ASC
  `;
  return rows.map((row) => ({ pathname: String(row.pathname), size: toInt(row.size) }));
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
 *     they uploaded rather than a cached prior version. The URL comes from the
 *     INDEX, not from a `head()`: the blob's public URL was already known at
 *     `put()` time, so rediscovering it was a billed operation buying nothing.
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
  const indexPath = blobPathForSlug(slug);
  const published = (await readGameBlobsForSlug(slug)).find(
    (row) => row.pathname === indexPath,
  );
  if (published) {
    try {
      const res = await fetch(published.url, { cache: "no-store" });
      if (res.ok) return await res.text();
    } catch {
      // Transient fetch failure — fall back to the static twin below rather
      // than reporting "nothing to copy".
    }
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

// ---------------------------------------------------------------------------
// Mutations — uncached. Callers revalidate GAMES_BLOB_CACHE_TAG.
// ---------------------------------------------------------------------------

/** What a writer knows about a blob the moment `put()` resolves. */
export type GameBlobRecord = {
  pathname: string;
  url: string;
  size: number;
  /** Epoch ms. Defaults to now, which is what a fresh `put()` means. */
  uploadedAt?: number;
};

/**
 * Record what a `put()` just wrote. Upserts on `pathname`, so re-publishing the
 * same file updates the URL and stamp rather than conflicting — which is what
 * makes a half-finished bundle upload safe to simply retry.
 *
 * Blobs whose path yields no slug (anything directly under `games/`, which the
 * table's CHECK would reject anyway) are skipped rather than thrown on: a writer
 * must never lose its upload to an indexing detail.
 *
 * THROWS on a database failure. Callers treat indexing as best-effort — the blob
 * is already written and the degradation is documented above — so they wrap this
 * in the same `try` as their other cleanup, never in the one guarding the `put`.
 */
export async function recordGameBlobs(
  records: readonly GameBlobRecord[],
): Promise<void> {
  const rows = records
    .map((record) => ({ ...record, slug: slugFromBlobPath(record.pathname) }))
    .filter((record): record is GameBlobRecord & { slug: string } =>
      record.slug !== null,
    );
  if (rows.length === 0) return;

  // One statement, not N round trips: a 300-file bundle upload would otherwise
  // pay 300 sequential HTTP queries against Neon on top of its 300 put()s. The
  // arrays are BOUND parameters — `unnest` expands them server-side — so nothing
  // is spliced into the SQL text.
  await sql`
    INSERT INTO game_blobs (pathname, slug, url, size, uploaded_at)
    SELECT * FROM unnest(
      ${rows.map((r) => r.pathname)}::text[],
      ${rows.map((r) => r.slug)}::text[],
      ${rows.map((r) => r.url)}::text[],
      ${rows.map((r) => r.size)}::int[],
      ${rows.map((r) => new Date(r.uploadedAt ?? Date.now()).toISOString())}::timestamptz[]
    )
    ON CONFLICT (pathname) DO UPDATE
      SET url = EXCLUDED.url,
          size = EXCLUDED.size,
          uploaded_at = EXCLUDED.uploaded_at
  `;
}

/** Forget the rows for blobs that have just been `del()`eted. */
export async function forgetGameBlobs(pathnames: readonly string[]): Promise<void> {
  if (pathnames.length === 0) return;
  await sql`DELETE FROM game_blobs WHERE pathname = ANY(${[...pathnames]}::text[])`;
}

/** Forget every row for one game — the reset/delete path. */
export async function forgetGameBlobsForSlug(slug: string): Promise<void> {
  await sql`DELETE FROM game_blobs WHERE slug = ${slug}`;
}

/**
 * Rebuild the whole index from ONE paginated `list()` of the `games/` prefix.
 *
 * THE ONLY `list()` LEFT IN THE APPLICATION, and the reason the mirror is
 * allowed to be lossy: anything written out-of-band (`publish-game.mjs`, an edit
 * in the Vercel dashboard, a deploy that predates the index) is recoverable by
 * pressing one button instead of by hand-writing rows.
 *
 * Deliberately NOT a truncate-then-insert: the delete is scoped to pathnames the
 * listing did NOT return, so a `list()` that fails half way through leaves the
 * table as it was rather than emptied. Returns what it did so the caller can put
 * numbers in the success banner — an operator spending a metered operation
 * deserves to be told what it bought.
 *
 * THROWS if the listing or the write fails; the caller turns that into a banner.
 */
export async function reindexGameBlobs(): Promise<{
  indexed: number;
  removed: number;
}> {
  const records: GameBlobRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: GAMES_PREFIX, cursor });
    for (const blob of page.blobs) {
      records.push({
        pathname: blob.pathname,
        url: blob.url,
        size: blob.size,
        uploadedAt: blob.uploadedAt.getTime(),
      });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  await recordGameBlobs(records);

  const live = records
    .map((record) => record.pathname)
    .filter((pathname) => slugFromBlobPath(pathname) !== null);
  const removed = await sql`
    DELETE FROM game_blobs
    WHERE NOT (pathname = ANY(${live}::text[]))
    RETURNING pathname
  `;

  return { indexed: live.length, removed: removed.length };
}
