/**
 * HallPass — a game's gameplay/intro video, over Neon.
 *
 * One row per game holding a YouTube video id. See `app/lib/game-videos.sql` for
 * the table and the reasoning behind storing an id rather than a URL.
 *
 * Shaped after `game-credits.ts`, deliberately, including the rules that matter:
 *
 * FAIL-SOFT: the public store page must render when Neon is unreachable, so
 * {@link getGameVideo} returns `null` on any failure. The try/catch lives at the
 * CALL SITE rather than inside the cached primitive — `unstable_cache` only stores
 * fulfilled results, so a transient blip must REJECT there or the empty map gets
 * cached under the tag for the full TTL and every game loses its video until
 * something invalidates it.
 *
 * SQL safety: the `neon()` tagged template parameterises interpolated VALUES; it
 * does NOT reliably splice raw SQL fragments. Only bound values appear here.
 *
 * MUTATIONS ARE UNCACHED. After any of them the calling server action MUST
 * `revalidateTag(VIDEOS_CACHE_TAG, { expire: 0 })` and
 * `revalidatePath("/game/<slug>")`. It must NOT call `bumpGamesVersion()` — that
 * sentinel makes every online client re-fetch every `/game-html/` URL with
 * `cache: "no-store"`, i.e. the entire game corpus re-downloaded because somebody
 * pasted a video link. Same rule as media and credits: this is page data, not a
 * PWA concern.
 *
 * NO SHARED TYPE CROSSES INTO THE CLIENT. `GameStore` takes a structural
 * `{ id, label }` prop rather than importing {@link GameVideo}, exactly as it takes
 * `credit` as a plain string — this module is `server-only` and must never appear
 * in a browser bundle's import graph, even as an erased type import.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "@/app/lib/db";
import { isYouTubeId } from "@/app/lib/youtube";

/** Cache tag for {@link readAllVideosCached}. */
export const VIDEOS_CACHE_TAG = "game-videos";

/** The longest label we will store; mirrors the CHECK in `013_game_videos.sql`. */
export const MAX_VIDEO_LABEL = 40;

/** What the store page's media toggle is called when no label was given. */
export const DEFAULT_VIDEO_LABEL = "Gameplay";

export type GameVideo = {
  slug: string;
  /** The bare 11-character YouTube id. Never a URL. */
  youtubeId: string;
  /** Editorial label for the toggle — "Gameplay", "Intro", "Trailer". */
  label: string;
};

type Row = Record<string, unknown>;

function mapVideo(row: Row): GameVideo {
  const label = String(row.label ?? "").trim();
  return {
    slug: String(row.slug),
    youtubeId: String(row.youtube_id),
    label: label.length > 0 ? label : DEFAULT_VIDEO_LABEL,
  };
}

/**
 * Read EVERY video row in one query, grouped by slug in JS.
 *
 * Same reasoning as `readAllCreditsCached()`: at most one row per game, read on
 * every store-page render, and one cache entry under one tag is far simpler to
 * invalidate than N per-slug entries. A per-slug `unstable_cache` would key on a
 * runtime argument and create unbounded entries.
 *
 * Rows whose id does not match {@link isYouTubeId} are DROPPED rather than
 * returned. The column has a CHECK enforcing the same shape, so this filter should
 * be unreachable — but the migration ledger exists because production was once
 * found to be missing migrations while the code for them was live, and every read
 * in this codebase is fail-soft enough that the symptom would have been silence.
 * Dropping here means `GameTrailer` can treat its id as valid without re-checking.
 *
 * THROWS on failure by design — see the fail-soft note in the module docblock.
 */
const readAllVideosCached = unstable_cache(
  async (): Promise<GameVideo[]> => {
    const rows = await sql`
      SELECT slug, youtube_id, label
      FROM game_videos
      ORDER BY slug ASC
    `;
    return rows.map(mapVideo).filter((v) => isYouTubeId(v.youtubeId));
  },
  ["game-videos"],
  { tags: [VIDEOS_CACHE_TAG], revalidate: 3600 },
);

/** Every video, keyed by slug. Fail-soft to an empty map. */
export async function getAllGameVideos(): Promise<Map<string, GameVideo>> {
  let all: GameVideo[];
  try {
    all = await readAllVideosCached();
  } catch {
    return new Map();
  }
  const bySlug = new Map<string, GameVideo>();
  for (const video of all) bySlug.set(video.slug, video);
  return bySlug;
}

/** One game's video, or `null` when it has none. Fail-soft. */
export async function getGameVideo(slug: string): Promise<GameVideo | null> {
  return (await getAllGameVideos()).get(slug) ?? null;
}

// ---------------------------------------------------------------------------
// Mutations — uncached. Callers revalidate.
// ---------------------------------------------------------------------------

/**
 * Attach or replace a game's video. OVERWRITES.
 *
 * Unlike `recordFirstUpload`'s `ON CONFLICT DO NOTHING`, this upserts: there is no
 * "first writer wins" claim to protect here, and replacing a dead or wrong link is
 * the whole reason the form exists.
 *
 * `created_at` is NOT touched on update — the correction is to WHICH video, not to
 * when one was first attached.
 *
 * Takes an id that has already been through `parseYouTubeId`. The column's CHECK
 * will reject anything else, which surfaces as a failed action rather than a bad
 * embed.
 */
export async function setGameVideo(
  slug: string,
  youtubeId: string,
  label: string,
  actorEmail: string,
): Promise<void> {
  await sql`
    INSERT INTO game_videos (slug, youtube_id, label, added_by)
    VALUES (${slug}, ${youtubeId}, ${label}, ${actorEmail})
    ON CONFLICT (slug) DO UPDATE
      SET youtube_id = EXCLUDED.youtube_id,
          label      = EXCLUDED.label,
          added_by   = EXCLUDED.added_by,
          updated_at = now()
  `;
}

/** Detach a game's video, so the store page stops offering the toggle. */
export async function clearGameVideo(slug: string): Promise<void> {
  await sql`DELETE FROM game_videos WHERE slug = ${slug}`;
}
