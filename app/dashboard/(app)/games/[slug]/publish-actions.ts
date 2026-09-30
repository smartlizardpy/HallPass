"use server";

/**
 * HallPass dashboard — PUBLISH a staged game.
 *
 * A staged game is visible only to beta testers and dashboard roles (see
 * `app/lib/game-staging.ts`). Publishing is the one button that ends that, and it
 * is an admin decision (`SITE_WRITE_ROLE`): it makes a game public, which is the
 * hardest thing on this site to take back.
 *
 * ── THE ORDER IS THE DESIGN ─────────────────────────────────────────────────
 * Nothing here is transactional — the writes span Neon, Vercel Blob and two
 * caches — so the steps are ordered by which half-finished state is recoverable,
 * exactly as `reviewShotAction` does for accept-then-publish. Every step is
 * idempotent, so the recovery for ANY failure is to press Publish again.
 *
 *   1. PRECONDITIONS. The game exists, is currently staged, and (for a native
 *      game) its index blob exists. Publishing a game with no playable file
 *      would make a public page that 404s in the iframe.
 *   2. COVER. Promote the chosen tester shot into `game_media` if it was not
 *      already (`publishShotToGallery`), flip that row to kind `hero` so it
 *      leaves the gallery, then point the game's cover at it. A failure here
 *      leaves the game staged, so nobody has seen a half-set cover.
 *   3. LEADERBOARD RESET (default ON). Testers' scores on a staged board are
 *      playtest noise; clearing them means the public board starts honest. Done
 *      BEFORE the flip so the board is never public while still holding them.
 *   4. `setGameStaged(slug, false)` — LAST. This is the moment the game goes
 *      live, so everything it should go live WITH has to be in place. A failure
 *      in steps 2-3 therefore cannot strand a public game with a wrong cover or
 *      a dirty board.
 *   5. INVALIDATE the caches and revalidate every surface the game joins.
 *
 * It deliberately does NOT call `bumpGamesVersion()`: that sentinel makes every
 * online client re-download the whole game corpus, and publishing changes no
 * game file. A native game's files are already in Blob (`chooseGameSource` serves
 * them for a staged slug and keeps doing so); the next deploy's `sync-games`
 * mirrors them into `public/games`.
 *
 * `redirect()` stays OUTSIDE every try, as everywhere in the dashboard.
 */

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { SITE_WRITE_ROLE } from "@/app/lib/permissions";
import { blobOpDisabledMessage, isBlobOpEnabled } from "@/app/lib/blob-ops";
import { beta, BETA_CREDITS_CACHE_TAG } from "@/app/lib/beta";
import { publishShotToGallery } from "@/app/lib/beta/publish-shot";
import { readGameBlobsForSlug } from "@/app/lib/game-blob-index";
import { blobPathForSlug } from "@/app/lib/game-html-blob";
import {
  MEDIA_CACHE_TAG,
  mediaBlobPath,
  mediaPublicPath,
  setMediaKind,
} from "@/app/lib/game-media";
import { toImageType } from "@/app/lib/image-meta";
import {
  CACHE_TAG,
  resolveGameIncludingStaged,
  setGameCover,
  setGameStaged,
} from "@/app/lib/games-store";
import {
  EXTERNAL_CACHE_TAG,
  setExternalGameStaged,
  updateExternalGameCover,
} from "@/app/lib/external-games-store";
import { store } from "@/app/lib/scoreboard";

function gamePage(slug: string, key: "ok" | "error", message: string): string {
  return `/dashboard/games/${encodeURIComponent(slug)}?${key}=${encodeURIComponent(message)}`;
}

/** Every cache and page the game joins by going public. */
function invalidatePublished(slug: string): void {
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
  revalidatePath("/sitemap.xml");
  revalidatePath("/llms.txt");
  revalidatePath("/llms-full.txt");
  revalidatePath(`/dashboard/games/${slug}`);
  revalidatePath("/dashboard/games");
}

/**
 * Publish a staged game. Form fields:
 *   - `slug`
 *   - `coverShotId` — an accepted `cover` beta shot, or empty to keep the
 *     current cover
 *   - `resetBoards` — a checkbox, TICKED BY DEFAULT in the panel. Absent means
 *     unticked: an unticked box posts nothing, so the default lives in the form,
 *     not here.
 */
export async function publishGameAction(formData: FormData): Promise<void> {
  await requireRole(SITE_WRITE_ROLE);

  const slug = String(formData.get("slug") ?? "").trim();
  const coverShotId = String(formData.get("coverShotId") ?? "").trim();
  const resetBoards = formData.get("resetBoards") === "on";
  if (!slug) redirect("/dashboard/games?error=Unknown+game");

  // ── 1. PRECONDITIONS ──────────────────────────────────────────────────────
  const game = await resolveGameIncludingStaged(slug);
  if (!game) redirect("/dashboard/games?error=Unknown+game");
  if (!game.staged) redirect(gamePage(slug, "error", "That game is already public"));

  const external = Boolean(game.externalUrl);
  if (!external) {
    let hasIndex = false;
    try {
      const indexPath = blobPathForSlug(slug);
      hasIndex = (await readGameBlobsForSlug(slug)).some((row) => row.pathname === indexPath);
    } catch {
      redirect(gamePage(slug, "error", "Could not check the game's files — nothing changed"));
    }
    if (!hasIndex) {
      redirect(
        gamePage(slug, "error", "This game has no published index.html yet — upload it first"),
      );
    }
  }

  // ── 2. COVER ──────────────────────────────────────────────────────────────
  if (coverShotId) {
    let shot;
    try {
      shot = await beta.shotById(coverShotId);
    } catch {
      redirect(gamePage(slug, "error", "Could not load that cover image — nothing changed"));
    }
    if (!shot || shot.slug !== slug || shot.kind !== "cover" || shot.status !== "accepted") {
      redirect(gamePage(slug, "error", "Pick an accepted cover image for this game"));
    }

    // A shot accepted long ago already has a media row; a fresh one does not and
    // needs the copy, which is an advanced Blob operation and so can be off.
    if (!shot.promotedMediaId && !(await isBlobOpEnabled("shot_promotion"))) {
      redirect(gamePage(slug, "error", blobOpDisabledMessage("shot_promotion")));
    }

    try {
      const mediaId = shot.promotedMediaId ?? (await publishShotToGallery(shot));
      if (!shot.promotedMediaId) await beta.markShotPromoted(shot.id, mediaId);
      await setMediaKind(mediaId, "hero");
      // Derived the same way `publishShotToGallery` derives the key, so no extra
      // read is needed to learn the row's path.
      const coverPath = mediaPublicPath({
        blobPath: mediaBlobPath(slug, mediaId, toImageType(shot.contentType)),
      });
      if (external) await updateExternalGameCover(slug, coverPath);
      else await setGameCover(slug, coverPath);
    } catch (error) {
      console.error(`publish ${slug}: cover step failed:`, error);
      redirect(gamePage(slug, "error", "Could not set the cover — nothing was published"));
    }
  }

  // ── 3. LEADERBOARD RESET ──────────────────────────────────────────────────
  if (resetBoards) {
    try {
      const boards = await store.listBoardsForGame(slug);
      for (const board of boards) await store.clearBoardScores(board.slug);
    } catch (error) {
      console.error(`publish ${slug}: leaderboard reset failed:`, error);
      redirect(gamePage(slug, "error", "Could not reset the leaderboards — nothing was published"));
    }
  }

  // ── 4. GO LIVE — LAST ─────────────────────────────────────────────────────
  try {
    if (external) await setExternalGameStaged(slug, false);
    else await setGameStaged(slug, false);
  } catch (error) {
    console.error(`publish ${slug}: flip failed:`, error);
    redirect(gamePage(slug, "error", "Could not publish (database error) — press Publish to retry"));
  }

  // ── 5. INVALIDATE ─────────────────────────────────────────────────────────
  invalidatePublished(slug);
  redirect(gamePage(slug, "ok", "Published — the game is now public"));
}
