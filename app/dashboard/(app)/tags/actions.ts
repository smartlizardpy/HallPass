"use server";

/**
 * HallPass dashboard — GLOBAL tag & genre maintenance server actions.
 *
 * Where curation tunes one game's badges, these actions fix a MISLABELLED tag or
 * genre across the WHOLE catalogue in a single sweep — the levers behind search
 * (tags) and the homepage category rows (genres). All three write through
 * `games-store.ts` ({@link renameTag} / {@link renameCategory}), which own the
 * `game_overrides` table, the per-game targeted writes, and the merge/dedup
 * semantics; this file is only the role gate, validation, and cache wiring.
 *
 * Control flow mirrors every other dashboard action: `requireRole("admin")`
 * first (fails closed), validate the inputs, wrap the single fallible store write
 * in a try/catch, and issue `redirect()` OUTSIDE that try — `redirect()` reports
 * via a thrown control signal a catch-all would otherwise swallow. Because a
 * rename/merge can touch many games at once, the post-write revalidation expires
 * the override data-cache tag and revalidates the whole app (`"/"`, `"layout"`)
 * rather than a single game route.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { CACHE_TAG, renameCategory, renameTag } from "@/app/lib/games-store";

/**
 * Build a `?ok`/`?error` redirect target back to the tags & genres tools, which
 * now live on the Curation page (the standalone "Tags & genres" tab was folded
 * into it).
 */
function target(key: "ok" | "error", message: string): string {
  return `/dashboard/curation?${key}=${encodeURIComponent(message)}`;
}

/**
 * Invalidate every cached surface a global tag/genre change touches: the
 * override data-cache tag (`{ expire: 0 }` = immediate expiry, Next.js's
 * read-your-own-writes form) plus the entire app tree — a catalogue-wide rename
 * can move games between search results and homepage category rows on any route,
 * so `revalidatePath("/", "layout")` is deliberately broad.
 */
function revalidateGlobal(): void {
  revalidateTag(CACHE_TAG, { expire: 0 });
  revalidatePath("/", "layout");
}

/**
 * Rename — or MERGE — a tag across every game. The row form posts the original
 * tag as `from` and the desired value as `to`; renaming `to` onto an existing
 * tag merges the two (the store de-duplicates). A blank `from` is a malformed
 * post (`?error`); `to === from` is a no-op that just bounces back. The store
 * write is wrapped in try/catch with a `null` failure sentinel so a legitimate
 * zero-games result is still reported as success. Redirect issued OUTSIDE the try.
 */
export async function renameTagAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "").trim();
  if (!from) redirect(target("error", "Missing tag."));
  if (to === from) redirect("/dashboard/curation");

  let changed: number | null = null;
  try {
    changed = await renameTag(from, to);
  } catch {
    changed = null;
  }
  if (changed === null) redirect(target("error", "Could not update tag"));

  revalidateGlobal();
  redirect(target("ok", `Updated ${changed} games`));
}

/**
 * Delete a tag everywhere — `renameTag(from, "")`, an empty target meaning
 * "remove `from` from every game that carries it". Same role gate, failure
 * sentinel, and global revalidation as {@link renameTagAction}.
 */
export async function deleteTagAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const from = String(formData.get("from") ?? "");
  if (!from) redirect(target("error", "Missing tag."));

  let changed: number | null = null;
  try {
    changed = await renameTag(from, "");
  } catch {
    changed = null;
  }
  if (changed === null) redirect(target("error", "Could not delete tag"));

  revalidateGlobal();
  redirect(target("ok", `Removed tag from ${changed} games`));
}

/**
 * Rename — or MERGE — a genre (category) across every game. A genre, unlike a
 * tag, can never be blank, so an empty `to` is rejected with `?error` before the
 * store is touched. Otherwise identical flow: write through {@link renameCategory},
 * revalidate globally, report via `?ok`. Redirect issued OUTSIDE the try.
 */
export async function renameGenreAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "").trim();
  if (!from) redirect(target("error", "Missing genre."));
  if (!to) redirect(target("error", "Genre name can’t be empty."));
  if (to === from) redirect("/dashboard/curation");

  let changed: number | null = null;
  try {
    changed = await renameCategory(from, to);
  } catch {
    changed = null;
  }
  if (changed === null) redirect(target("error", "Could not update genre"));

  revalidateGlobal();
  redirect(target("ok", `Updated ${changed} games`));
}
