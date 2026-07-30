"use server";

/**
 * Server actions for a game's gameplay/intro video.
 *
 * Its own file rather than more weight in `games/actions.ts`, matching how
 * `media-actions.ts`, `achievement-actions.ts` and `credit-actions.ts` are already
 * split out.
 *
 * THREE RULES CARRIED OVER FROM `credit-actions.ts`, all for the same reasons:
 *
 * 1. THIS MUST NOT CALL `bumpGamesVersion()`. That sentinel makes every online
 *    client re-fetch every `/game-html/` URL with `cache: "no-store"` — the whole
 *    ~11 MB game corpus re-downloaded because somebody pasted a link. A video is
 *    page data, exactly like a screenshot or a credit line.
 *
 * 2. `redirect()` GOES OUTSIDE THE TRY. It signals navigation by throwing, so a
 *    `catch` around it swallows the redirect and leaves the admin staring at a form
 *    that appears to have done nothing.
 *
 * 3. `isResolvedSlug`, NEVER the static `games` array — the static array silently
 *    excludes every external game, and an external game (no bundled source, often
 *    no screenshots of its own) is exactly the kind that most needs a video.
 *
 * THE URL IS PARSED HERE AND ONLY THE ID IS STORED. `parseYouTubeId` validates the
 * host rather than pattern-matching for `v=`, so a link on a look-alike domain is
 * rejected rather than embedded; see `app/lib/youtube.ts`. The column's CHECK is a
 * second line of defence, and a failure there surfaces as "could not save" rather
 * than as a bad iframe.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import {
  DEFAULT_VIDEO_LABEL,
  MAX_VIDEO_LABEL,
  VIDEOS_CACHE_TAG,
  clearGameVideo,
  setGameVideo,
} from "@/app/lib/game-videos";
import { isResolvedSlug } from "@/app/lib/games-store";
import { parseYouTubeId } from "@/app/lib/youtube";

function target(slug: string, status: "ok" | "error", message: string): string {
  return `/dashboard/games/${encodeURIComponent(slug)}?${status}=${encodeURIComponent(message)}`;
}

export async function setGameVideoAction(formData: FormData): Promise<void> {
  const { email: actorEmail } = await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  const url = String(formData.get("videoUrl") ?? "").trim();
  const rawLabel = String(formData.get("videoLabel") ?? "").trim();

  if (!slug || !(await isResolvedSlug(slug))) {
    redirect("/dashboard/games?error=Unknown+game.");
  }

  // An empty URL means "detach the video", which is the honest way to undo a wrong
  // or dead link. The store page then renders exactly as it did before the feature.
  if (!url) {
    let failed = false;
    try {
      await clearGameVideo(slug);
    } catch {
      failed = true;
    }
    if (!failed) {
      revalidateTag(VIDEOS_CACHE_TAG, { expire: 0 });
      revalidatePath(`/game/${slug}`);
    }
    redirect(
      failed
        ? target(slug, "error", "Could not remove the video. Try again.")
        : target(slug, "ok", "Video removed"),
    );
  }

  const videoId = parseYouTubeId(url);
  if (!videoId) {
    redirect(
      target(
        slug,
        "error",
        "That is not a YouTube link. Paste a watch, youtu.be, shorts or embed URL.",
      ),
    );
  }

  const label = rawLabel || DEFAULT_VIDEO_LABEL;
  if (label.length > MAX_VIDEO_LABEL) {
    redirect(
      target(slug, "error", `Label must be ${MAX_VIDEO_LABEL} characters or fewer.`),
    );
  }

  let failed = false;
  try {
    await setGameVideo(slug, videoId, label, actorEmail);
  } catch {
    failed = true;
  }
  if (!failed) {
    revalidateTag(VIDEOS_CACHE_TAG, { expire: 0 });
    revalidatePath(`/game/${slug}`);
  }

  redirect(
    failed
      ? target(slug, "error", "Could not save the video. Try again.")
      : target(slug, "ok", "Video saved"),
  );
}
