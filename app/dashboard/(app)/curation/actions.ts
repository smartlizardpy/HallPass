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
 * otherwise swallow. After a successful write we `updateTag(CACHE_TAG)` and
 * `revalidatePath(...)` the public surfaces that render the change.
 */

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { games } from "@/app/lib/games";
import { CACHE_TAG, setFeaturedGame, setGameNew } from "@/app/lib/games-store";
import { gameDropCopy } from "@/app/lib/notifications/copy";
import { notifyEveryone } from "@/app/lib/notifications/deliver";

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
  updateTag(CACHE_TAG);
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

  // ── THE GAME DROP ANNOUNCEMENT ──────────────────────────────────────────
  // Marking a game NEW is the moment an admin says "this is a drop", so it is
  // the trigger — rather than a game row appearing, which happens while a game
  // is still being set up, or a separate "announce" button, which would be a
  // second thing to remember and would drift out of step with the badge.
  //
  // ONLY ON THE WAY UP. Removing the badge is not news.
  //
  // KEYED ON THE SLUG, so the announcement is once per game FOREVER. Toggling
  // the badge off and on again — which admins do while curating the homepage
  // row — files nothing the second time and therefore buzzes nobody. The unique
  // index in 024 enforces that in the database rather than by convention here,
  // which matters because this is the one kind that reaches the whole site.
  //
  // AWAITED before the redirect, and never allowed to fail it: `notifyEveryone`
  // does not reject, and `redirect()` throws a control signal, so the two must
  // not be interleaved.
  if (value) {
    await notifyEveryone({
      kind: "game_drop",
      copy: gameDropCopy({
        // The display TITLE from the static catalogue, never the slug —
        // "neon-velocity-hyperdrive just landed" is not something to put on a
        // lock screen. The slug is already validated as known above, so this
        // lookup cannot miss; the fallback is belt and braces.
        title: games.find((g) => g.slug === slug)?.title ?? slug,
        slug,
      }),
      dedupeKey: `game_drop:${slug}`,
    });
  }

  revalidateCuration(slug);
  redirect(target("ok", value ? "Marked new" : "New badge removed"));
}
