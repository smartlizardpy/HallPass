"use server";

/**
 * HallPass dashboard — per-game DETAILS + TAGS (override) server actions.
 *
 * These edit the descriptive override layer for a single game in the
 * `game_overrides` Neon table (see `app/lib/games-store.ts`). The immutable
 * presentation (slug, gradient, art, …) is never touched here; nor is the
 * playable HTML, which has its own actions in `../actions.ts`. The `is_new` /
 * `is_featured` curation flags are owned by the Curation page — these forms never
 * touch them. {@link updateGameAction} owns the text fields (title/tagline/
 * description/category); {@link setGameTagsAction} owns the `tags` list, posted by
 * the chip editor in `_ui/TagEditor`; {@link setGamePlatformAction} owns the
 * `platform` tag, which is a CAPABILITY (what the game runs on) rather than copy —
 * hence its own form, and hence not living on the Curation page with the editorial
 * flags.
 *
 * Override semantics (the load-bearing part) — every write is SPARSE, touching
 * ONLY its own columns so the rest of the row stays as-is:
 *   - text fields (title/tagline/description/category): a trimmed value that
 *     DIFFERS from the static catalogue default SETS the override; an empty value
 *     OR one equal to the default stores `null` (inherit the default). Written via
 *     `setDetailsOverride`, a single-column-set upsert — so a details save leaves
 *     tags AND the Curation flags untouched.
 *   - tags: arrive one form field per chip via `getAll("tags")`, trimmed, empties
 *     dropped, deduped case-insensitively → `string[]`; written via `setGameTags`
 *     (likewise sparse). An empty list overrides to "no tags"; nothing submitted
 *     stores `null` (inherit the static defaults).
 *
 * Authorization + control flow mirror the rest of the dashboard: every action
 * runs `requireRole("admin")` first, validates the slug against the static
 * catalogue, wraps the single fallible store write in a try/catch, and issues its
 * `redirect()` OUTSIDE that try (redirect signals via a thrown control object,
 * which a catch-all would otherwise swallow). After a mutation we
 * `revalidateTag(CACHE_TAG)` and `revalidatePath(...)` every public surface that
 * renders game copy so the edit appears immediately.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { games, toGamePlatform } from "@/app/lib/games";
import {
  CACHE_TAG,
  clearOverride,
  setDetailsOverride,
  setGamePlatform,
  setGameTags,
} from "@/app/lib/games-store";

/**
 * A trimmed value SETS the override only when it differs from the game's static
 * default; an empty value OR one equal to the default inherits (`null`), so each
 * field is pinned independently and unchanged fields stay dynamic.
 */
function overrideString(
  value: FormDataEntryValue | null,
  fallback: string,
): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" || trimmed === fallback ? null : trimmed;
}

/**
 * Invalidate every cached surface that renders a game's descriptive copy: the
 * override data-cache tag plus the public routes that read it (home, the game's
 * own page, the sitemap, and the LLM manifest).
 */
function revalidateGame(slug: string): void {
  // `{ expire: 0 }` reproduces the legacy single-arg `revalidateTag` semantics —
  // immediate expiry — which this Next.js made the deprecated form. It's the
  // documented choice for read-your-own-writes (the admin must see the edit on
  // the very next render) and is what invalidates the `unstable_cache`-backed
  // override read in `games-store.ts`.
  revalidateTag(CACHE_TAG, { expire: 0 });
  revalidatePath("/");
  revalidatePath(`/game/${slug}`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/llms-full.txt");
}

/**
 * Save the TEXT override fields for one game. The slug is immutable, arrives via
 * a hidden field, and must name a real game. We build a SPARSE patch (each field
 * pinned only when it differs from the static default — see the file header) and
 * write it through `setDetailsOverride`, whose single-column-set upsert leaves the
 * Curation-owned `is_new`/`is_featured` flags AND the separately-edited tags
 * untouched, then revalidate and land back on the control center with `?ok`. A
 * write failure bounces back with `?error`, redirect issued OUTSIDE the try.
 */
export async function updateGameAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) redirect("/dashboard/games?error=" + encodeURIComponent("Unknown game."));
  if (!games.some((g) => g.slug === slug)) redirect("/dashboard/games?error=Unknown+game");

  // The matched static entry seeds the per-field inherit comparison: anything
  // equal to its default is stored as `null` (dynamic) rather than pinned.
  const base = games.find((g) => g.slug === slug)!;

  let saveFailed = false;
  try {
    // `setDetailsOverride` is a sparse, single-column-set write: it touches ONLY
    // title/tagline/description/category, leaving the Curation-owned is_new/
    // is_featured flags AND the separately-edited tags untouched — so a details
    // save can never clobber them.
    await setDetailsOverride(slug, {
      title: overrideString(formData.get("title"), base.title),
      tagline: overrideString(formData.get("tagline"), base.tagline),
      description: overrideString(formData.get("description"), base.description),
      category: overrideString(formData.get("category"), base.category),
    });
  } catch {
    saveFailed = true;
  }
  if (saveFailed) {
    redirect(
      `/dashboard/games/${encodeURIComponent(slug)}?error=${encodeURIComponent("Could not save details")}`,
    );
  }

  revalidateGame(slug);
  redirect(
    `/dashboard/games/${encodeURIComponent(slug)}?ok=${encodeURIComponent("Saved")}`,
  );
}

/**
 * Save the curated tag list for one game. The chip editor (`_ui/TagEditor`) emits
 * one `tags` field PER selected tag, so the list arrives via `getAll("tags")`
 * rather than a single comma-joined string. Each value is trimmed, empties are
 * dropped, and duplicates are removed CASE-INSENSITIVELY (first spelling wins) to
 * mirror the editor's own hygiene. The write goes through the sparse
 * `setGameTags` helper so it touches ONLY the `tags` column — an empty list is a
 * real override ("no tags"), and we store `null` (inherit the static defaults)
 * only when nothing was submitted. Same auth + control-flow shape as
 * {@link updateGameAction}; redirect issued OUTSIDE the try.
 */
export async function setGameTagsAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) redirect("/dashboard/games?error=" + encodeURIComponent("Unknown game."));
  if (!games.some((g) => g.slug === slug)) redirect("/dashboard/games?error=Unknown+game");

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of formData.getAll("tags")) {
    const trimmed = String(raw).trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(trimmed);
  }

  let saveFailed = false;
  try {
    await setGameTags(slug, tags.length ? tags : null);
  } catch {
    saveFailed = true;
  }
  if (saveFailed) {
    redirect(
      `/dashboard/games/${encodeURIComponent(slug)}?error=${encodeURIComponent("Could not save tags")}`,
    );
  }

  revalidateGame(slug);
  redirect(
    `/dashboard/games/${encodeURIComponent(slug)}?ok=${encodeURIComponent("Tags saved")}`,
  );
}

/**
 * Save which devices a game is playable on.
 *
 * The submitted value is narrowed by `toGamePlatform`, so anything unrecognised —
 * including the empty string the "Unknown" radio posts — becomes `null` and
 * stores as SQL NULL. That is a deliberate, reachable state, not a validation
 * failure: an admin who tagged a game wrong must be able to put it back to "not
 * checked" so the public site stops asserting anything about it. Clearing the tag
 * is NOT `clearGameOverrideAction`, which would also discard their copy edits.
 *
 * Writes through the sparse `setGamePlatform`, so it touches only the one column
 * and leaves title/tagline/tags and the Curation flags intact. Same auth +
 * control-flow shape as {@link updateGameAction}; redirect issued OUTSIDE the try.
 */
export async function setGamePlatformAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) redirect("/dashboard/games?error=" + encodeURIComponent("Unknown game."));
  if (!games.some((g) => g.slug === slug)) redirect("/dashboard/games?error=Unknown+game");

  const platform = toGamePlatform(formData.get("platform"));

  let saveFailed = false;
  try {
    await setGamePlatform(slug, platform);
  } catch {
    saveFailed = true;
  }
  if (saveFailed) {
    redirect(
      `/dashboard/games/${encodeURIComponent(slug)}?error=${encodeURIComponent("Could not save platform")}`,
    );
  }

  revalidateGame(slug);
  redirect(
    `/dashboard/games/${encodeURIComponent(slug)}?ok=${encodeURIComponent(
      platform ? `Plays on: ${platform}` : "Platform cleared",
    )}`,
  );
}

/**
 * Drop a game's override row entirely, reverting every descriptive field to the
 * static catalogue default. Same revalidation + control-flow shape as
 * {@link updateGameAction}.
 */
export async function clearGameOverrideAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) redirect("/dashboard/games?error=" + encodeURIComponent("Unknown game."));

  let clearFailed = false;
  try {
    await clearOverride(slug);
  } catch {
    clearFailed = true;
  }
  if (clearFailed) {
    redirect(
      `/dashboard/games/${encodeURIComponent(slug)}?error=${encodeURIComponent("Could not reset details")}`,
    );
  }

  revalidateGame(slug);
  redirect(
    `/dashboard/games/${encodeURIComponent(slug)}?ok=${encodeURIComponent("Reset to defaults")}`,
  );
}
