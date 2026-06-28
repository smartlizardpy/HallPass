"use server";

/**
 * HallPass dashboard — homepage CURATION server actions.
 *
 * The two presentation levers the arcade homepage reads off the override layer:
 *   - the single FEATURED game (the hero) — exactly one at a time, so setting one
 *     is a swap, not an add ({@link setFeaturedGame} clears the prior holder).
 *   - each game's NEW flag — drives the "New games" row and the per-card badge.
 *
 * Both write through `games-store.ts` (`setFeaturedGame` / `setGameNew`), which
 * own the `game_overrides` table and the clear-the-old-featured invariant; this
 * file is only the role gate, validation, and cache wiring.
 *
 * Control flow mirrors every other dashboard action: `requireRole("admin")`
 * first (fails closed), validate the slug against the STATIC catalogue, wrap the
 * single fallible store write in a try/catch, and issue `redirect()` OUTSIDE that
 * try — `redirect()` reports via a thrown control signal a catch-all would
 * otherwise swallow. After a successful write we `revalidateTag(CACHE_TAG)` and
 * `revalidatePath(...)` the public surfaces that render the change.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { games } from "@/app/lib/games";
import { CACHE_TAG, setFeaturedGame, setGameNew } from "@/app/lib/games-store";

/** True when `slug` names a game in the static catalogue. */
function isKnownSlug(slug: string): boolean {
  return games.some((g) => g.slug === slug);
}

/** Build a `?ok`/`?error` redirect target back to the curation page. */
function target(key: "ok" | "error", message: string): string {
  return `/dashboard/curation?${key}=${encodeURIComponent(message)}`;
}

/**
 * Invalidate every cached surface a curation change touches: the override
 * data-cache tag (`{ expire: 0 }` = immediate expiry, this Next.js's read-your-
 * own-writes form) plus the home page and the affected game's own page.
 */
function revalidateCuration(slug: string): void {
  revalidateTag(CACHE_TAG, { expire: 0 });
  revalidatePath("/");
  revalidatePath("/game/" + slug);
}

/**
 * Promote one game to the homepage hero. The radio list posts a single `slug`;
 * we confirm it names a known game, hand off to {@link setFeaturedGame} (which
 * demotes the previous holder so only one game is ever featured), revalidate,
 * and land back with `?ok`. A write failure bounces back with `?error`, the
 * redirect issued OUTSIDE the try.
 */
export async function setFeaturedAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug || !isKnownSlug(slug)) redirect(target("error", "Unknown game."));

  let saveFailed = false;
  try {
    await setFeaturedGame(slug);
  } catch {
    saveFailed = true;
  }
  if (saveFailed) redirect(target("error", "Could not set featured game"));

  revalidateCuration(slug);
  redirect(target("ok", "Featured updated"));
}

/**
 * Flip one game's NEW flag. The inline form carries the slug plus the DESIRED
 * next state as a string (`value="true"`/`"false"`), so the action is idempotent
 * and self-describing. Validate the slug, write through {@link setGameNew},
 * revalidate, and report via `?ok`/`?error` (redirect OUTSIDE the try).
 */
export async function toggleNewAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  const value = formData.get("value") === "true";
  if (!slug || !isKnownSlug(slug)) redirect(target("error", "Unknown game."));

  let saveFailed = false;
  try {
    await setGameNew(slug, value);
  } catch {
    saveFailed = true;
  }
  if (saveFailed) redirect(target("error", "Could not update New badge"));

  revalidateCuration(slug);
  redirect(target("ok", value ? "Marked new" : "New badge removed"));
}
