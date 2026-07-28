"use server";

/**
 * Server actions for a game's credit line — who made it.
 *
 * Its own file rather than more weight in `games/actions.ts`, matching how
 * `media-actions.ts` and `achievement-actions.ts` are already split out.
 *
 * TWO RULES CARRIED OVER FROM `media-actions.ts`, both for the same reason:
 *
 * 1. THESE MUST NOT CALL `bumpGamesVersion()`. That sentinel makes every online
 *    client re-fetch every `/game-html/` URL with `cache: "no-store"` — the whole
 *    ~11 MB game corpus re-downloaded because somebody fixed a spelling in a
 *    credit line. A credit is page data, exactly like a screenshot.
 *
 * 2. `redirect()` goes OUTSIDE the try. It signals navigation by throwing, so a
 *    `catch` around it silently swallows the redirect and leaves the admin
 *    staring at a form that appears to have done nothing.
 *
 * The credit set here OVERWRITES, unlike the automatic capture on upload which is
 * `ON CONFLICT DO NOTHING`. That asymmetry is the point: the automatic path must
 * never re-attribute a game when someone re-uploads it, while a human correcting
 * a wrong or missing credit obviously must win.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { CREDITS_CACHE_TAG, clearCredit, setCredit } from "@/app/lib/game-credits";
import { isResolvedSlug } from "@/app/lib/games-store";

/** Longest credit we will store; mirrors the CHECK in `010_game_credits.sql`. */
const MAX_NAME = 60;

function target(slug: string, status: "ok" | "error", message: string): string {
  return `/dashboard/games/${encodeURIComponent(slug)}?${status}=${encodeURIComponent(message)}`;
}

export async function setGameCreditAction(formData: FormData): Promise<void> {
  const { email: actorEmail } = await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  const name = String(formData.get("creditName") ?? "").trim();

  // `isResolvedSlug`, never the static `games` array — the static array silently
  // excludes every external game, and an external game is exactly the kind that
  // most needs a credit.
  if (!slug || !(await isResolvedSlug(slug))) {
    redirect("/dashboard/games?error=Unknown+game.");
  }

  // An empty field means "remove the credit", which is the honest way to undo a
  // wrong one. Filling it with a placeholder would publish a guess.
  if (!name) {
    let failed = false;
    try {
      await clearCredit(slug);
    } catch {
      failed = true;
    }
    if (!failed) {
      revalidateTag(CREDITS_CACHE_TAG, { expire: 0 });
      revalidatePath(`/game/${slug}`);
    }
    redirect(
      failed
        ? target(slug, "error", "Could not clear the credit. Try again.")
        : target(slug, "ok", "Credit cleared"),
    );
  }

  if (name.length > MAX_NAME) {
    redirect(target(slug, "error", `Name must be ${MAX_NAME} characters or fewer.`));
  }

  let failed = false;
  try {
    await setCredit(slug, name, actorEmail);
  } catch {
    failed = true;
  }
  if (!failed) {
    revalidateTag(CREDITS_CACHE_TAG, { expire: 0 });
    revalidatePath(`/game/${slug}`);
  }

  redirect(
    failed
      ? target(slug, "error", "Could not save the credit. Try again.")
      : target(slug, "ok", "Credit saved"),
  );
}
