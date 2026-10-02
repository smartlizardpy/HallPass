/**
 * HallPass — changing a game's cover art, in ONE place.
 *
 * Two server actions end up here: Publish (which can pick a tester's cover shot
 * as it takes a staged game live) and the dashboard's Change-cover panel (which
 * can do the same for a game of any state). They used to be one inline block in
 * `publish-actions.ts`; sharing it is what keeps "a cover" meaning the same
 * thing from both doors.
 *
 * ── THE DATABASE IS THE SOURCE OF TRUTH ─────────────────────────────────────
 * A cover is `game_overrides.cover_url` (or `external_games.cover_url`) pointing
 * at a `/game-media/<slug>/<id>.<ext>` URL, plus the `game_media` row behind it
 * with `kind = 'hero'` (which keeps it out of the gallery and its 8-image cap).
 * Every in-app surface resolves the cover through the catalogue, so writing the
 * pointer and invalidating the caches is the whole of a change — no deploy and
 * nothing committed to Git. The one reader that bypasses the catalogue is the
 * share-card renderer (`og/brand.tsx`), which reads `public/games/<slug>/
 * cover.png` from disk; `scripts/sync-games.mjs` mirrors the chosen cover there
 * at the next deploy (see `scripts/lib/cover-mirror.mjs`).
 *
 * REPLACING A COVER DELETES NOTHING. The old pointer is simply overwritten and
 * its hero row stays, which is what makes the dashboard's "previous covers" list
 * (and so undo) possible.
 *
 * Every function is idempotent and orders its writes so that the pointer — the
 * only write a visitor can observe — comes LAST: a failure part-way leaves the
 * old cover showing, and repeating the action converges.
 *
 * Never calls `bumpGamesVersion()`: no game file changed, and that sentinel
 * would make every online client re-download the whole corpus.
 */

import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { beta, BETA_CREDITS_CACHE_TAG } from "@/app/lib/beta";
import { blobOpDisabledMessage, isBlobOpEnabled } from "@/app/lib/blob-ops";
import type { BetaShot } from "@/app/lib/beta/store";
import { publishShotToGallery } from "@/app/lib/beta/publish-shot";
import {
  MEDIA_CACHE_TAG,
  getMediaForSlug,
  mediaBlobPath,
  mediaPublicPath,
  setMediaKind,
} from "@/app/lib/game-media";
import { toImageType } from "@/app/lib/image-meta";
import { CACHE_TAG, setGameCover } from "@/app/lib/games-store";
import {
  EXTERNAL_CACHE_TAG,
  updateExternalGameCover,
} from "@/app/lib/external-games-store";

/** The public URL a media row's cover pointer holds. */
export function coverPathFor(slug: string, id: string, contentType: string): string {
  return mediaPublicPath({
    blobPath: mediaBlobPath(slug, id, toImageType(contentType)),
  });
}

async function writePointer(
  slug: string,
  path: string | null,
  external: boolean,
): Promise<void> {
  if (external) await updateExternalGameCover(slug, path);
  else await setGameCover(slug, path);
}

/**
 * Make an accepted tester shot the game's cover. The caller has already checked
 * the shot belongs to `slug`, is a `cover` and is accepted. Returns the pointer.
 *
 * A shot that was never promoted needs the Blob `copy()` (an advanced operation,
 * gated by `shot_promotion` — the CALLER checks that switch so it can redirect
 * with the right message before anything is written). A promoted shot whose
 * media row was deleted is re-promoted here, behind the same switch.
 */
export async function setCoverFromShot(
  shot: BetaShot,
  external: boolean,
): Promise<string> {
  let mediaId = shot.promotedMediaId ?? (await publishShotToGallery(shot));
  if (!shot.promotedMediaId) await beta.markShotPromoted(shot.id, mediaId);
  if (!(await setMediaKind(mediaId, "hero"))) {
    // The shot was promoted once, but its media row has since been deleted (a
    // gallery delete). Pointing the cover at it would leave a dangling URL, so
    // copy it back in — idempotent, the media id is the shot id — or fail and
    // keep the old cover if that Blob operation is switched off.
    if (!(await isBlobOpEnabled("shot_promotion"))) {
      throw new Error(blobOpDisabledMessage("shot_promotion"));
    }
    mediaId = await publishShotToGallery(shot);
    if (!(await setMediaKind(mediaId, "hero"))) {
      throw new Error(`media row ${mediaId} is missing after re-promotion`);
    }
  }
  // Derived the way `publishShotToGallery` derives the key, so no extra read.
  const path = coverPathFor(shot.slug, mediaId, shot.contentType);
  await writePointer(shot.slug, path, external);
  return path;
}

/**
 * Make an existing `game_media` row of this slug the cover — a previous cover or
 * a gallery screenshot. Moving it to `hero` takes a screenshot out of the gallery
 * (so the cover costs no gallery slot and does not appear twice). Returns the
 * pointer, or `null` when the id is not one of this game's rows.
 */
export async function setCoverFromMedia(
  slug: string,
  mediaId: string,
  external: boolean,
): Promise<string | null> {
  const media = await getMediaForSlug(slug, mediaId);
  if (!media) return null;
  await setMediaKind(media.id, "hero");
  const path = mediaPublicPath(media);
  await writePointer(slug, path, external);
  return path;
}

/**
 * Drop the override so the game falls back to its static `coverUrl` and then the
 * committed `public/games/<slug>/cover.png`. Native games only: an external game
 * has no repo cover to fall back to.
 */
export async function clearCover(slug: string): Promise<void> {
  await setGameCover(slug, null);
}

/** Every cache and page a cover change is visible on. */
export function invalidateCover(slug: string): void {
  updateTag(CACHE_TAG);
  updateTag(EXTERNAL_CACHE_TAG);
  updateTag(MEDIA_CACHE_TAG);
  updateTag(BETA_CREDITS_CACHE_TAG);
  revalidatePath("/");
  revalidatePath("/games");
  revalidatePath("/new");
  revalidatePath(`/game/${slug}`);
  revalidatePath("/category/[category]", "page");
  revalidatePath("/tag/[tag]", "page");
  revalidatePath(`/dashboard/games/${slug}`);
  revalidatePath("/dashboard/games");
}
