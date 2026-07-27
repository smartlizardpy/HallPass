/**
 * HallPass — game media (screenshots) store over Neon.
 *
 * One row per image on a game's `/game/<slug>` store page. See
 * `app/lib/game-media.sql` for the table and the full reasoning behind the blob
 * prefix; the short version is that the bytes live under `game-media/<slug>/`
 * and NOT `games/<slug>/`, because three dashboard actions delete that prefix
 * wholesale, `sync-games.mjs` mirrors it into the repo, and the service worker
 * precaches everything mirrored.
 *
 * Shaped after `games-store.ts`, deliberately, including the two rules that
 * matter:
 *
 * FAIL-SOFT: the public store page must render when Neon is unreachable, so
 * {@link getGameMedia} returns `[]` on any failure. The try/catch lives at the
 * CALL SITE rather than inside the cached primitive — `unstable_cache` only
 * stores fulfilled results, so a transient blip must REJECT there or the empty
 * list gets cached under the tag for the full TTL and every game loses its
 * gallery until something invalidates it.
 *
 * SQL safety: the `neon()` tagged template parameterises interpolated VALUES; it
 * does NOT reliably splice raw SQL fragments. Only bound values are ever
 * interpolated here — including the reorder, which binds a `text[]` rather than
 * building an `ORDER BY`/`CASE` fragment.
 *
 * MUTATIONS ARE UNCACHED. After any of them the calling server action MUST
 * `revalidateTag(MEDIA_CACHE_TAG, { expire: 0 })` and
 * `revalidatePath("/game/<slug>")`. It must NOT call `bumpGamesVersion()` — that
 * sentinel makes every online client re-fetch every `/game-html/` URL with
 * `cache: "no-store"`, i.e. the entire game corpus re-downloaded because someone
 * uploaded a screenshot. Media freshness is page data, not a PWA concern.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";
import { extensionForType, type ImageType } from "@/app/lib/image-meta";

/**
 * Cache tag for {@link readAllMediaCached}. Re-exported so server actions can
 * invalidate without re-declaring the literal.
 */
export const MEDIA_CACHE_TAG = "game-media";

/** The Vercel Blob prefix for a game's media. NEVER `games/<slug>/` — see above. */
export function mediaBlobPrefix(slug: string): string {
  return `game-media/${slug}/`;
}

/** The blob key for one image. `id` is random, so the key is content-stable. */
export function mediaBlobPath(slug: string, id: string, type: ImageType): string {
  return `${mediaBlobPrefix(slug)}${id}.${extensionForType(type)}`;
}

/**
 * The public, same-origin URL for a media row.
 *
 * Same-origin is not cosmetic. `public/sw.js` returns early for cross-origin
 * requests, and `isCacheable()` requires `res.type === "basic" || "default"`, so
 * a raw Vercel Blob URL can NEVER be cached by the service worker. Serving
 * through our own `/game-media/` route puts screenshots in the `cacheFirst`
 * branch, which is what makes them available offline after one online visit.
 */
export function mediaPublicPath(media: GameMedia): string {
  return `/${media.blobPath}`;
}

export type GameMediaKind = "screenshot" | "hero";

export type GameMedia = {
  id: string;
  slug: string;
  kind: GameMediaKind;
  /** Blob key, which doubles as the same-origin URL path. */
  blobPath: string;
  contentType: ImageType;
  width: number;
  height: number;
  bytes: number;
  alt: string;
  position: number;
};

type Row = Record<string, unknown>;

/** Postgres INTEGER arrives as a JS number, but be defensive about NULL/strings. */
function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapMedia(row: Row): GameMedia {
  return {
    id: String(row.id),
    slug: String(row.slug),
    kind: (String(row.kind) === "hero" ? "hero" : "screenshot") as GameMediaKind,
    blobPath: String(row.blob_path),
    contentType: String(row.content_type) as ImageType,
    width: toInt(row.width),
    height: toInt(row.height),
    bytes: toInt(row.bytes),
    alt: row.alt == null ? "" : String(row.alt),
    position: toInt(row.position),
  };
}

/**
 * Read EVERY media row in one query, grouped by slug in JS.
 *
 * Same reasoning as `readOverrides()` in `games-store.ts`: the table is small
 * (bounded at 8 rows per game), the store page reads it on every render, and one
 * cache entry with one tag is far simpler to invalidate than N per-slug entries.
 * A per-slug `unstable_cache` would also key the cache on a runtime argument,
 * creating an unbounded number of entries.
 *
 * THROWS on failure by design — see the fail-soft note in the module docblock.
 */
const readAllMediaCached = unstable_cache(
  async (): Promise<GameMedia[]> => {
    const rows = await sql`
      SELECT id, slug, kind, blob_path, content_type, width, height, bytes, alt, position
      FROM game_media
      ORDER BY slug ASC, position ASC, created_at ASC
    `;
    return rows.map(mapMedia);
  },
  ["game-media"],
  { tags: [MEDIA_CACHE_TAG], revalidate: 3600 },
);

/** Every media row, keyed by slug. Fail-soft to an empty map. */
export async function getAllGameMedia(): Promise<Map<string, GameMedia[]>> {
  let all: GameMedia[];
  try {
    all = await readAllMediaCached();
  } catch {
    return new Map();
  }
  const bySlug = new Map<string, GameMedia[]>();
  for (const media of all) {
    const list = bySlug.get(media.slug);
    if (list) list.push(media);
    else bySlug.set(media.slug, [media]);
  }
  return bySlug;
}

/** A single game's media in display order. Fail-soft to `[]`. */
export async function getGameMedia(slug: string): Promise<GameMedia[]> {
  return (await getAllGameMedia()).get(slug) ?? [];
}

// ---------------------------------------------------------------------------
// Mutations — uncached. Callers revalidate.
// ---------------------------------------------------------------------------

/**
 * Append one image to a slug's gallery.
 *
 * `position` is resolved server-side as `max(position) + 1` in the same
 * statement rather than read-then-write, so two concurrent uploads cannot both
 * claim the same slot. Duplicate positions would not be an error even then —
 * reads tiebreak on `created_at` — but this keeps the common case tidy.
 */
export async function insertMedia(media: {
  id: string;
  slug: string;
  kind: GameMediaKind;
  blobPath: string;
  contentType: ImageType;
  width: number;
  height: number;
  bytes: number;
  alt?: string;
}): Promise<void> {
  await sql`
    INSERT INTO game_media (id, slug, kind, blob_path, content_type, width, height, bytes, alt, position)
    SELECT ${media.id}, ${media.slug}, ${media.kind}, ${media.blobPath},
           ${media.contentType}, ${media.width}, ${media.height}, ${media.bytes},
           ${media.alt ?? ""},
           COALESCE((SELECT max(position) + 1 FROM game_media WHERE slug = ${media.slug}), 0)
  `;
}

/**
 * Delete one image row, returning its blob key so the caller can delete the
 * object too. Returns `null` for an unknown id.
 *
 * The row goes first and the blob second — deliberately the OPPOSITE of
 * `deleteExternalGameAction`, which leaves its cover blob behind. A cover is one
 * small file per game; media is up to 8 × 4 MB per game, so orphaned objects
 * would accumulate fast enough to matter. Losing the blob delete after the row
 * delete leaks one object; losing the row delete after the blob delete would
 * leave a row pointing at a 404, which is worse.
 */
export async function deleteMedia(id: string): Promise<string | null> {
  const rows = await sql`
    DELETE FROM game_media WHERE id = ${id} RETURNING blob_path
  `;
  return rows.length > 0 ? String(rows[0].blob_path) : null;
}

/** Set one image's alt text. */
export async function setMediaAlt(id: string, alt: string): Promise<void> {
  await sql`
    UPDATE game_media SET alt = ${alt}, updated_at = now() WHERE id = ${id}
  `;
}

/**
 * Rewrite the display order for a slug from an ordered list of ids.
 *
 * This is the one genuinely tricky query in the feature. The obvious approaches
 * — a spliced `CASE WHEN id='a' THEN 0 ...` ladder, or N separate UPDATEs — are
 * both wrong here: the first violates the no-SQL-fragment rule this codebase
 * enforces everywhere, and the second is N round trips on a driver with no
 * connection reuse, non-atomic, and leaves a torn order if one fails.
 *
 * `unnest($1::text[]) WITH ORDINALITY` turns a single BOUND array into an
 * (id, index) relation to join against, so the whole reorder is one statement
 * with one bound parameter. The `slug` predicate means a caller cannot reorder
 * another game's rows by passing foreign ids.
 */
export async function reorderMedia(slug: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`
    UPDATE game_media AS m
    SET position = x.pos - 1, updated_at = now()
    FROM unnest(${ids}::text[]) WITH ORDINALITY AS x(id, pos)
    WHERE m.id = x.id AND m.slug = ${slug}
  `;
}

/** How many images a slug already has — used to enforce the per-game cap. */
export async function countMediaForSlug(slug: string): Promise<number> {
  const rows = await sql`
    SELECT count(*)::int AS n FROM game_media WHERE slug = ${slug}
  `;
  return rows.length > 0 ? toInt(rows[0].n) : 0;
}

/**
 * Look up one row by its blob path. Used by the serving route to confirm a
 * requested object is actually registered media before streaming it, rather than
 * trusting the URL to name any object in the store.
 */
export async function getMediaByBlobPath(
  blobPath: string,
): Promise<GameMedia | null> {
  const rows = await sql`
    SELECT id, slug, kind, blob_path, content_type, width, height, bytes, alt, position
    FROM game_media
    WHERE blob_path = ${blobPath}
  `;
  return rows.length > 0 ? mapMedia(rows[0]) : null;
}
