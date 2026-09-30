/**
 * HallPass — copy an approved beta shot into the game-media store.
 *
 * Lives in `app/lib/beta/` rather than beside `reviewShotAction` because that
 * file is `"use server"`: every export of a server-actions module becomes a
 * callable endpoint, and this takes a whole shot row as its argument. Two
 * callers need it — the review actions, and the dashboard's Publish action,
 * which promotes a tester's cover shot that was accepted before it was ever
 * needed as a cover.
 */

import "server-only";
import { copy } from "@vercel/blob";
import { insertMedia } from "@/app/lib/game-media";
import { mediaBlobPath } from "@/app/lib/game-media-blob";
import { toImageType } from "@/app/lib/image-meta";

/**
 * Copy an approved shot into the public gallery.
 *
 * ── WHY A COPY AND NOT A POINTER ────────────────────────────────────────────
 * `mediaPublicPath()` derives a media row's URL straight from its `blob_path`,
 * and the only route that serves those is `/game-media/`. A `game_media` row
 * left pointing at `beta-shots/…` would therefore resolve to a URL nothing
 * answers — the image would be in the gallery and still invisible. So the object
 * moves under the `game-media/` prefix, which is what `mediaBlobPath()` builds.
 *
 * `copy()` is one ADVANCED Blob operation, and the Hobby allowance is 2,000 a
 * month. At a handful of accepted shots that is noise, but it is why this
 * happens once on acceptance rather than on every gallery read.
 *
 * ── THE MEDIA ID IS THE SHOT ID, DELIBERATELY ───────────────────────────────
 * That makes the whole sequence idempotent: `copy()` overwrites the same key,
 * `insertMedia()` now conflicts away on the primary key, and `markShotPromoted`
 * is guarded on the pointer still being null. A retry after a half-finished
 * publish converges instead of creating a second gallery entry.
 *
 * Never touches the `games/` prefix — see `game-media.sql` for the seven
 * behaviours that sweep it — and never calls `bumpGamesVersion()`, which would
 * force every online client to re-download the whole corpus over one screenshot.
 */
export async function publishShotToGallery(shot: {
  id: string;
  slug: string;
  blobPath: string;
  blobUrl: string | null;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
}): Promise<string> {
  const contentType = toImageType(shot.contentType);
  const blobPath = mediaBlobPath(shot.slug, shot.id, contentType);
  // `copy` takes the source URL when there is one; the stored path is the
  // fallback for a row written before `blob_url` existed.
  const copied = await copy(shot.blobUrl ?? shot.blobPath, blobPath, {
    access: "public",
    addRandomSuffix: false,
  });
  await insertMedia({
    id: shot.id,
    slug: shot.slug,
    kind: "screenshot",
    blobPath,
    blobUrl: copied.url,
    contentType,
    width: shot.width,
    height: shot.height,
    bytes: shot.bytes,
  });
  return shot.id;
}
