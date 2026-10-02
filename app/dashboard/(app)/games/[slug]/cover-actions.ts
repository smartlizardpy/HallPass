"use server";

/**
 * HallPass dashboard — CHANGE a game's cover art, staged or live.
 *
 * Until now a tester's cover could only be chosen at the moment a staged game was
 * published. This is the same choice available at any time, from three places:
 * accepted tester cover shots, the game's earlier covers (so a change can be
 * undone) and its gallery screenshots — or `original`, which clears the override
 * and falls back to the committed `public/games/<slug>/cover.png`. No upload: a
 * brand-new image goes in as a beta cover shot or via `publish-game --cover`.
 *
 * The mechanics live in `app/lib/game-cover.ts` (shared with Publish). The order
 * is the design: validate everything and check the Blob switch BEFORE writing,
 * then promote → hero → pointer LAST, so a failure leaves the old cover showing
 * and pressing the button again converges. Caches are invalidated only on
 * success. `redirect()` stays OUTSIDE every try, as everywhere in the dashboard.
 *
 * The message on success tells the admin that share cards (link previews) only
 * pick the new cover up at the next deploy — they read the deployed
 * `public/games/<slug>/cover.png`, which `sync-games` refreshes then.
 */

import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { SITE_WRITE_ROLE } from "@/app/lib/permissions";
import { blobOpDisabledMessage, isBlobOpEnabled } from "@/app/lib/blob-ops";
import { beta } from "@/app/lib/beta";
import {
  clearCover,
  invalidateCover,
  setCoverFromMedia,
  setCoverFromShot,
} from "@/app/lib/game-cover";
import { resolveGameIncludingStaged } from "@/app/lib/games-store";

function gamePage(slug: string, key: "ok" | "error", message: string): string {
  return `/dashboard/games/${encodeURIComponent(slug)}?${key}=${encodeURIComponent(message)}`;
}

const SHARE_HINT =
  " In-app pages update now; link-preview images refresh at the next deploy (run the Deploy workflow).";

/**
 * Form fields:
 *   - `slug`
 *   - `source` — `shot` | `media` | `original`
 *   - `id` — the beta shot id (`shot`) or the game_media id (`media`)
 */
export async function changeCoverAction(formData: FormData): Promise<void> {
  await requireRole(SITE_WRITE_ROLE);

  const slug = String(formData.get("slug") ?? "").trim();
  const source = String(formData.get("source") ?? "").trim();
  const id = String(formData.get("id") ?? "").trim();
  if (!slug) redirect("/dashboard/games?error=Unknown+game");

  const game = await resolveGameIncludingStaged(slug);
  if (!game) redirect("/dashboard/games?error=Unknown+game");
  const external = Boolean(game.externalUrl);

  if (source === "original") {
    if (external) {
      redirect(gamePage(slug, "error", "An off-site game has no original cover to go back to"));
    }
    try {
      await clearCover(slug);
    } catch (error) {
      console.error(`cover ${slug}: clear failed:`, error);
      redirect(gamePage(slug, "error", "Could not restore the original cover"));
    }
    invalidateCover(slug);
    redirect(gamePage(slug, "ok", `Back to the original cover.${SHARE_HINT}`));
  }

  if (source === "shot") {
    if (!id) redirect(gamePage(slug, "error", "Pick a cover image"));
    let shot;
    try {
      shot = await beta.shotById(id);
    } catch {
      redirect(gamePage(slug, "error", "Could not load that cover image — nothing changed"));
    }
    if (!shot || shot.slug !== slug || shot.kind !== "cover" || shot.status !== "accepted") {
      redirect(gamePage(slug, "error", "Pick an accepted cover image for this game"));
    }
    if (!shot.promotedMediaId && !(await isBlobOpEnabled("shot_promotion"))) {
      redirect(gamePage(slug, "error", blobOpDisabledMessage("shot_promotion")));
    }
    try {
      await setCoverFromShot(shot, external);
    } catch (error) {
      console.error(`cover ${slug}: shot step failed:`, error);
      redirect(gamePage(slug, "error", "Could not set the cover — it was not changed"));
    }
    invalidateCover(slug);
    redirect(gamePage(slug, "ok", `Cover changed.${SHARE_HINT}`));
  }

  if (source === "media") {
    if (!id) redirect(gamePage(slug, "error", "Pick a cover image"));
    let path: string | null = null;
    try {
      path = await setCoverFromMedia(slug, id, external);
    } catch (error) {
      console.error(`cover ${slug}: media step failed:`, error);
      redirect(gamePage(slug, "error", "Could not set the cover — it was not changed"));
    }
    if (!path) redirect(gamePage(slug, "error", "That image is no longer on this game"));
    invalidateCover(slug);
    redirect(gamePage(slug, "ok", `Cover changed.${SHARE_HINT}`));
  }

  redirect(gamePage(slug, "error", "Pick a cover image"));
}
