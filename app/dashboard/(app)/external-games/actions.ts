"use server";

/**
 * HallPass dashboard — EXTERNAL (off-site) games server actions.
 *
 * These register, EDIT, and remove whole games that live OFF-SITE: their play
 * surface is a third-party URL embedded in an iframe, and each is a
 * self-describing row in the `external_games` Neon table (see
 * `@/app/lib/external-games-store`), APPENDED to the resolved catalogue after
 * the static entries. Unlike the per-game override actions in
 * `../games/[slug]/actions.ts`, there is no static catalogue entry to inherit
 * from — every column is authoritative, so the edit actions here overwrite
 * fields outright rather than storing sparse overrides.
 *
 * External games have no separate list page: they are created from the Games tab
 * ("Add external game") and edited from the SAME per-game control center as
 * native games (`/dashboard/games/<slug>`), so the create/edit/re-cache/delete
 * actions all report back to `/dashboard/games` surfaces.
 *
 * Slug ownership: the derived slug must NOT collide with a static game (that
 * would shadow a real, playable catalogue entry) NOR an existing external row
 * (the table's primary key would reject it anyway, but we reject early with a
 * friendly banner). Both checks run before any write.
 *
 * Cover generation is FAIL-SOFT and NEVER blocks creation. In BOTH paths the
 * image is downloaded once and re-hosted on Vercel Blob so a visitor's device
 * never re-fetches it from a third-party host on every page load:
 *   - a manual `coverUrl` (e.g. from an off-site HTML/thumbnail page) is fetched
 *     and cached to Blob, falling back to the verbatim URL only if that fails;
 *   - otherwise we best-effort screenshot the site via a third-party service and
 *     upload the result to Blob.
 * ANY failure (bad response, non-image, timeout, blob error) leaves the cover
 * null and the game is still created — `GameCard` renders a gradient placeholder.
 *
 * Control-flow note (shared with every dashboard action): `redirect()` works by
 * THROWING a Next.js control signal, so it must never sit inside a `try`/`catch`
 * that swallows all errors. The single fallible DB write is wrapped tightly and
 * reduced to a boolean; the `redirect()` reporting the outcome is issued OUTSIDE
 * that `try`. `requireRole("admin")` is the FIRST line of every action and fails
 * closed (redirects an under-privileged caller before any work happens).
 */

import { del, put } from "@vercel/blob";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { CREDITS_CACHE_TAG, recordFirstUpload } from "@/app/lib/game-credits";
import { games, toGamePlatform } from "@/app/lib/games";
import {
  EXTERNAL_CACHE_TAG,
  createExternalGame,
  deleteExternalGame,
  getExternalGame,
  setExternalGamePlatform,
  updateExternalGameCover,
  updateExternalGameDetails,
} from "@/app/lib/external-games-store";
import {
  MEDIA_CACHE_TAG,
  deleteAllMediaForSlug,
} from "@/app/lib/game-media";

/** Matches a valid slug: starts alphanumeric, then alphanumerics/hyphens. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Derive a URL-safe slug from a free-text title: lowercase, non-alphanumerics →
 * hyphens, collapse runs of hyphens, and trim leading/trailing hyphens so the
 * result satisfies {@link SLUG_RE} (or is empty, which the caller rejects).
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** True when `value` is a valid absolute http(s) URL. */
function isHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

/** Build a `?error=` redirect target for the create form. */
function newErrorTarget(message: string): string {
  return `/dashboard/external-games/new?error=${encodeURIComponent(message)}`;
}

/**
 * Build an `?ok`/`?error` redirect target back to a game's per-game control
 * center under the unified Games tab. External games no longer have their own
 * list page — every external game is edited from `/dashboard/games/<slug>`
 * alongside native games — so post-mutation banners land there.
 */
function controlTarget(slug: string, key: "ok" | "error", message: string): string {
  return `/dashboard/games/${encodeURIComponent(slug)}?${key}=${encodeURIComponent(message)}`;
}

/**
 * Invalidate every cached surface an external game appears on: the external-games
 * data-cache tag plus the public routes that read the resolved catalogue (home,
 * the games index, the game's own page, the sitemap, and the LLM manifest).
 * `{ expire: 0 }` reproduces the immediate-expiry semantics the rest of the
 * dashboard uses for read-your-own-writes.
 */
function revalidateExternal(slug: string): void {
  updateTag(EXTERNAL_CACHE_TAG);
  revalidatePath("/");
  revalidatePath("/games");
  revalidatePath(`/game/${slug}`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/llms-full.txt");
}

/**
 * Map an image `content-type` to a filename extension for the blob path. The
 * extension is cosmetic — Blob serves the bytes with the `contentType` we pass to
 * `put`, not with a type inferred from the path — but a matching extension keeps
 * the stored object honest. Anything not listed (still a valid `image/*`) is
 * stored as `.img`; the correct `contentType` header is preserved regardless.
 */
const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

/**
 * Download an image from `imageUrl` and re-host it on Vercel Blob under the game's
 * cover path, returning the stable public blob URL.
 *
 * This is the whole point of the caching: whether the bytes come from the
 * screenshot service or an admin-pasted off-site cover, we pull them ONCE here so
 * every later render points at OUR blob (CDN-served, service-worker-precacheable)
 * instead of at the third-party host — the device stops re-fetching the image on
 * every visit.
 *
 * FAIL-SOFT and total: the entire fetch + blob upload is wrapped so it can NEVER
 * throw out of the create action. On ANY problem — non-OK response, a response
 * that is not an image, a network timeout, or a blob write failure — we return
 * `null` and let the caller decide the fallback.
 *
 * `fetch` (undici) has NO default timeout, so without an `AbortSignal` a hang
 * (a stalled screenshot render, a slow third-party host) would block the create
 * action until the serverless function is killed — no row inserted, a platform
 * 5xx to the admin — the OPPOSITE of the fail-soft guarantee this module
 * documents. The 8s bound makes a stall REJECT into the catch (=> null) instead.
 */
async function cacheCoverToBlob(slug: string, imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;

    // Split off any `; charset=…` parameter before matching/validating.
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!contentType.startsWith("image/")) return null;

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) return null;

    const ext = IMAGE_EXT[contentType] ?? "img";
    const blob = await put(`games/${slug}/cover.${ext}`, Buffer.from(bytes), {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return blob.url;
  } catch {
    // Best-effort: a missing cover is cosmetic, never a reason to fail creation.
    return null;
  }
}

/**
 * Best-effort screenshot cover for a freshly registered external game: build the
 * third-party screenshot URL and hand it to {@link cacheCoverToBlob}, which pulls
 * the PNG once and re-hosts it on our blob. Returns the blob URL, or `null` on any
 * failure (the game is still created with a gradient placeholder).
 *
 * Privacy note: this sends the target URL to a third-party screenshot service
 * (thum.io); the create form warns the admin of that.
 */
async function generateCover(slug: string, externalUrl: string): Promise<string | null> {
  return cacheCoverToBlob(
    slug,
    `https://image.thum.io/get/width/1318/crop/1226/${externalUrl}`,
  );
}

/**
 * Register a new external-URL game.
 *
 * Validation order: derive + validate the slug, validate the external URL, then
 * reject slug collisions against BOTH the static catalogue and the existing
 * external rows — each failure short-circuits back to the form via `?error=`.
 * Only once the input is sound do we generate the cover (fail-soft) and attempt
 * the DB insert, whose outcome decides the final banner. The insert is the sole
 * fallible step inside a `try`; the `redirect()` is issued OUTSIDE it.
 */
export async function createExternalGameAction(formData: FormData): Promise<void> {
  const { email: actorEmail } = await requireRole("admin");

  const title = String(formData.get("title") ?? "").trim();
  const externalUrl = String(formData.get("externalUrl") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const tagline = String(formData.get("tagline") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const accent = String(formData.get("accent") ?? "").trim() || "#7c5cff";
  const gradientFrom = String(formData.get("gradientFrom") ?? "").trim() || "#7c5cff";
  const gradientTo = String(formData.get("gradientTo") ?? "").trim() || "#00e5ff";
  const coverOverride = String(formData.get("coverUrl") ?? "").trim();
  // Unrecognised (including the empty string the "Unknown" option submits) → null,
  // which stores as SQL NULL and means nobody has checked what this game runs on.
  // Not defaulted to "both": an untested claim of mobile support is the one thing
  // this tag exists to stop the site from making.
  const platform = toGamePlatform(formData.get("platform"));

  // Tags arrive one field per chip from the TagEditor (getAll), trimmed + deduped
  // case-insensitively (first spelling wins) to mirror the editor's own hygiene.
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

  if (!title) redirect(newErrorTarget("Title is required."));

  const slug = slugify(title);
  if (!slug || !SLUG_RE.test(slug)) {
    redirect(newErrorTarget("Could not derive a valid slug from the title."));
  }

  if (!externalUrl) redirect(newErrorTarget("External URL is required."));
  if (!isHttpUrl(externalUrl)) {
    redirect(newErrorTarget("External URL must be a valid http(s) URL."));
  }

  if (games.some((g) => g.slug === slug)) {
    redirect(newErrorTarget(`Slug "${slug}" collides with a built-in game.`));
  }
  if ((await getExternalGame(slug)) != null) {
    redirect(newErrorTarget(`An external game with slug "${slug}" already exists.`));
  }

  // Cover: a valid manual override is downloaded and re-hosted on our blob so the
  // device never re-fetches it from the third-party host on every visit; if that
  // caching fails we fall back to the verbatim URL (a working cover beats none).
  // With no override we best-effort screenshot → blob, which fails soft to null.
  let finalCoverUrl: string | null = null;
  if (coverOverride && isHttpUrl(coverOverride)) {
    finalCoverUrl = (await cacheCoverToBlob(slug, coverOverride)) ?? coverOverride;
  } else {
    finalCoverUrl = await generateCover(slug, externalUrl);
  }

  let saveFailed = false;
  try {
    await createExternalGame({
      slug,
      title,
      tagline,
      description,
      category,
      tags,
      externalUrl,
      coverUrl: finalCoverUrl,
      accent,
      gradientFrom,
      gradientTo,
      isNew: true,
      isFeatured: false,
      platform,
    });
  } catch {
    saveFailed = true;
  }
  if (saveFailed) redirect(newErrorTarget("Could not save the external game. Try again."));

  // Registering an external game IS its first upload — it is the moment the game
  // appears on the site — so it earns a credit exactly like a bundle does.
  await recordFirstUpload(slug, actorEmail);
  updateTag(CREDITS_CACHE_TAG);

  revalidateExternal(slug);
  // Land on the new game's control center under the unified Games tab, where all
  // further editing (details, tags, cover, delete) now happens.
  redirect(controlTarget(slug, "ok", "External game added."));
}

/**
 * Save the descriptive fields of an existing external game from its per-game
 * control center: title, tagline, description, category, external URL, and the
 * accent/gradient colours. Tags have their own action
 * ({@link setExternalGameTagsAction}) and the cover has its own controls, so
 * this preserves both by reading the current row and re-writing only what this
 * form owns. An optional cover-URL override, when supplied, is downloaded and
 * re-hosted on our blob exactly as the create form does.
 *
 * Same control-flow contract as every dashboard action: `requireRole("admin")`
 * first, validate, wrap the fallible DB write in a `try`, issue `redirect()`
 * OUTSIDE it.
 */
export async function updateExternalGameAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) redirect("/dashboard/games?error=" + encodeURIComponent("Unknown game."));

  const existing = await getExternalGame(slug);
  if (!existing) {
    redirect("/dashboard/games?error=" + encodeURIComponent(`No external game "${slug}".`));
  }

  const title = String(formData.get("title") ?? "").trim();
  const externalUrl = String(formData.get("externalUrl") ?? "").trim();
  const tagline = String(formData.get("tagline") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const accent = String(formData.get("accent") ?? "").trim() || "#7c5cff";
  const gradientFrom = String(formData.get("gradientFrom") ?? "").trim() || "#7c5cff";
  const gradientTo = String(formData.get("gradientTo") ?? "").trim() || "#00e5ff";
  const coverOverride = String(formData.get("coverUrl") ?? "").trim();

  if (!title) redirect(controlTarget(slug, "error", "Title is required."));
  if (!externalUrl) redirect(controlTarget(slug, "error", "External URL is required."));
  if (!isHttpUrl(externalUrl)) {
    redirect(controlTarget(slug, "error", "External URL must be a valid http(s) URL."));
  }

  // Cover is optional on edit: a supplied override is re-hosted on our blob (with
  // a verbatim-URL fallback if caching fails); a blank field leaves the existing
  // cover untouched, so a details save never clears a good cover.
  let newCover: string | null | undefined;
  if (coverOverride) {
    if (!isHttpUrl(coverOverride)) {
      redirect(controlTarget(slug, "error", "Cover URL must be a valid http(s) URL."));
    }
    newCover = (await cacheCoverToBlob(slug, coverOverride)) ?? coverOverride;
  }

  let saveFailed = false;
  try {
    await updateExternalGameDetails(slug, {
      title,
      tagline,
      description,
      category,
      tags: existing.tags, // owned by setExternalGameTagsAction — preserved here
      externalUrl,
      accent,
      gradientFrom,
      gradientTo,
    });
    if (newCover !== undefined) await updateExternalGameCover(slug, newCover);
  } catch {
    saveFailed = true;
  }
  if (saveFailed) redirect(controlTarget(slug, "error", "Could not save details."));

  revalidateExternal(slug);
  redirect(controlTarget(slug, "ok", "Saved."));
}

/**
 * Save the tag list of an existing external game. External games carry their
 * tags in the `external_games` row (NOT `game_overrides`), so this reads the
 * current row and re-writes it with the new tags, leaving every other field
 * intact. Tags arrive one field per chip from the shared `TagEditor`, trimmed +
 * deduped case-insensitively to mirror the editor's hygiene.
 */
export async function setExternalGameTagsAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) redirect("/dashboard/games?error=" + encodeURIComponent("Unknown game."));

  const existing = await getExternalGame(slug);
  if (!existing) {
    redirect("/dashboard/games?error=" + encodeURIComponent(`No external game "${slug}".`));
  }

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
    await updateExternalGameDetails(slug, {
      title: existing.title,
      tagline: existing.tagline,
      description: existing.description,
      category: existing.category,
      tags,
      externalUrl: existing.externalUrl!,
      accent: existing.accent,
      gradientFrom: existing.gradient[0],
      gradientTo: existing.gradient[1],
    });
  } catch {
    saveFailed = true;
  }
  if (saveFailed) redirect(controlTarget(slug, "error", "Could not save tags."));

  revalidateExternal(slug);
  redirect(controlTarget(slug, "ok", "Tags saved."));
}

/**
 * Save which devices an external game is playable on.
 *
 * The external twin of `setGamePlatformAction` (native games, `game_overrides`).
 * The submitted value narrows through `toGamePlatform`, so anything unrecognised
 * — including the empty string the "Unknown" radio posts — becomes `null` and
 * stores as SQL NULL. Unknown is a reachable state on purpose: a wrong tag badges
 * and re-sorts the game on every visitor's device, so it has to be undoable.
 *
 * Writes through the single-column `setExternalGamePlatform` rather than
 * `updateExternalGameDetails`, which full-replaces every descriptive column.
 */
export async function setExternalGamePlatformAction(
  formData: FormData,
): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) redirect("/dashboard/games?error=" + encodeURIComponent("Unknown game."));

  const existing = await getExternalGame(slug);
  if (!existing) {
    redirect("/dashboard/games?error=" + encodeURIComponent(`No external game "${slug}".`));
  }

  const platform = toGamePlatform(formData.get("platform"));

  let saveFailed = false;
  try {
    await setExternalGamePlatform(slug, platform);
  } catch {
    saveFailed = true;
  }
  if (saveFailed) redirect(controlTarget(slug, "error", "Could not save platform."));

  revalidateExternal(slug);
  redirect(
    controlTarget(
      slug,
      "ok",
      platform ? `Plays on: ${platform}` : "Platform cleared.",
    ),
  );
}

/**
 * Re-cache an existing external game's cover into Vercel Blob (the one-click
 * "backfill" for rows created before covers were re-hosted, or a plain refresh).
 *
 * Source preference mirrors create: if the row already carries a bespoke
 * `coverUrl` (typically the verbatim off-site URL of a legacy row) we pull THAT
 * and re-host it; otherwise — or if that pull fails — we fall back to a fresh
 * screenshot of the external URL. On success the row is repointed at the blob
 * copy so the device stops re-fetching from the third-party host.
 *
 * FAIL-SOFT: if nothing could be cached we leave the existing cover untouched and
 * report it via `?error=` rather than clearing a working (if hotlinked) cover.
 * The DB write is the sole fallible step inside a `try`; `redirect()` is OUTSIDE.
 */
export async function recacheExternalCoverAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) {
    redirect(`/dashboard/games?error=${encodeURIComponent("Unknown game.")}`);
  }

  const game = await getExternalGame(slug);
  if (!game) {
    redirect(`/dashboard/games?error=${encodeURIComponent(`No external game "${slug}".`)}`);
  }

  // Prefer re-hosting the existing cover source; fall back to a fresh screenshot.
  let cached: string | null = null;
  if (game.coverUrl && isHttpUrl(game.coverUrl)) {
    cached = await cacheCoverToBlob(slug, game.coverUrl);
  }
  if (!cached && game.externalUrl) {
    cached = await generateCover(slug, game.externalUrl);
  }
  if (!cached) {
    redirect(
      controlTarget(
        slug,
        "error",
        "Could not fetch a cover to cache. The existing cover was left unchanged.",
      ),
    );
  }

  let saveFailed = false;
  try {
    await updateExternalGameCover(slug, cached);
  } catch {
    saveFailed = true;
  }
  if (saveFailed) {
    redirect(controlTarget(slug, "error", "Cached the cover but could not save it. Try again."));
  }

  revalidateExternal(slug);
  redirect(controlTarget(slug, "ok", "Cover re-cached to blob storage."));
}

/**
 * Delete an external game by slug. Same auth + revalidation shape as create; the
 * row delete is the desired end-state either way, so a failure inside the `try`
 * is treated as reached ("gone") rather than surfaced. The blob cover (if any) is
 * left in place — an unreferenced blob is harmless and cheaper to skip than to
 * chase. Redirect issued OUTSIDE the try.
 */
export async function deleteExternalGameAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) {
    redirect(`/dashboard/games?error=${encodeURIComponent("Unknown game.")}`);
  }

  try {
    await deleteExternalGame(slug);
  } catch {
    // Best-effort: the row is gone or never existed, which is the goal anyway.
  }

  // The game's screenshots go with it. `game_media.slug` is deliberately NOT a
  // foreign key (games live in a static array plus this table, not one table), so
  // nothing cascades — and because the slug is the only join key, re-creating a
  // game with the same slug would otherwise inherit the deleted game's gallery.
  try {
    const blobPaths = await deleteAllMediaForSlug(slug);
    await Promise.allSettled(blobPaths.map((path: string) => del(path)));
    if (blobPaths.length > 0) updateTag(MEDIA_CACHE_TAG);
  } catch {
    // Best-effort cleanup; the game row is already gone, which is what users see.
  }

  revalidateExternal(slug);
  // The game is gone — land on the Games grid rather than its now-404 page.
  redirect(`/dashboard/games?ok=${encodeURIComponent("External game deleted.")}`);
}
