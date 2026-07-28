"use server";

/**
 * HallPass dashboard — EXTERNAL (off-site) games server actions.
 *
 * These register and remove whole games that live OFF-SITE: their play surface
 * is a third-party URL embedded in an iframe, and each is a self-describing row
 * in the `external_games` Neon table (see `@/app/lib/external-games-store`),
 * APPENDED to the resolved catalogue after the static entries. Unlike the
 * per-game override actions in `../games/[slug]/actions.ts`, there is no static
 * catalogue entry to inherit from — the create form supplies every field.
 *
 * Slug ownership: the derived slug must NOT collide with a static game (that
 * would shadow a real, playable catalogue entry) NOR an existing external row
 * (the table's primary key would reject it anyway, but we reject early with a
 * friendly banner). Both checks run before any write.
 *
 * Cover generation is FAIL-SOFT and NEVER blocks creation: if the admin supplies
 * a manual `coverUrl` we use it verbatim; otherwise we best-effort screenshot the
 * site via a third-party service and upload the PNG to Vercel Blob. ANY failure
 * (bad response, non-image, timeout, blob error) leaves the cover null and the
 * game is still created — `GameCard` renders a gradient placeholder.
 *
 * Control-flow note (shared with every dashboard action): `redirect()` works by
 * THROWING a Next.js control signal, so it must never sit inside a `try`/`catch`
 * that swallows all errors. The single fallible DB write is wrapped tightly and
 * reduced to a boolean; the `redirect()` reporting the outcome is issued OUTSIDE
 * that `try`. `requireRole("admin")` is the FIRST line of every action and fails
 * closed (redirects an under-privileged caller before any work happens).
 */

import { del, put } from "@vercel/blob";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { CREDITS_CACHE_TAG, recordFirstUpload } from "@/app/lib/game-credits";
import { games } from "@/app/lib/games";
import {
  EXTERNAL_CACHE_TAG,
  createExternalGame,
  deleteExternalGame,
  getExternalGame,
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
 * Invalidate every cached surface an external game appears on: the external-games
 * data-cache tag plus the public routes that read the resolved catalogue (home,
 * the games index, the game's own page, the sitemap, and the LLM manifest).
 * `{ expire: 0 }` reproduces the immediate-expiry semantics the rest of the
 * dashboard uses for read-your-own-writes.
 */
function revalidateExternal(slug: string): void {
  revalidateTag(EXTERNAL_CACHE_TAG, { expire: 0 });
  revalidatePath("/");
  revalidatePath("/games");
  revalidatePath(`/game/${slug}`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/llms-full.txt");
}

/**
 * Best-effort screenshot cover for a freshly registered external game.
 *
 * FAIL-SOFT and total: the entire screenshot fetch + blob upload is wrapped so it
 * can NEVER throw out of the create action. On ANY problem — non-OK response, a
 * response that is not an image, a network timeout, or a blob write failure — we
 * return `null` and the game is created with no cover (the app renders a gradient
 * placeholder). On success we return the uploaded blob URL.
 *
 * Privacy note: this sends the target URL to a third-party screenshot service
 * (thum.io); the create form warns the admin of that.
 */
async function generateCover(slug: string, externalUrl: string): Promise<string | null> {
  try {
    // thum.io renders the screenshot synchronously and can stall on a heavy or
    // unresponsive target. `fetch` (undici) has NO default timeout, so without an
    // AbortSignal a hang would block the create action until the serverless
    // function is killed — no row inserted, a platform 5xx to the admin — which
    // is the OPPOSITE of the fail-soft "timeout => null, game still created"
    // guarantee this module documents. Bound the request so a stall REJECTS into
    // the catch below (=> null cover, creation proceeds) instead of hanging.
    const res = await fetch(
      `https://image.thum.io/get/width/1318/crop/1226/${externalUrl}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) return null;

    const blob = await put(`games/${slug}/cover.png`, Buffer.from(bytes), {
      access: "public",
      contentType: "image/png",
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

  // Cover: a valid manual override wins verbatim (no screenshot); otherwise
  // best-effort screenshot → blob, which fails soft to null.
  let finalCoverUrl: string | null = null;
  if (coverOverride && isHttpUrl(coverOverride)) {
    finalCoverUrl = coverOverride;
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
    });
  } catch {
    saveFailed = true;
  }
  if (saveFailed) redirect(newErrorTarget("Could not save the external game. Try again."));

  // Registering an external game IS its first upload — it is the moment the game
  // appears on the site — so it earns a credit exactly like a bundle does.
  await recordFirstUpload(slug, actorEmail);
  revalidateTag(CREDITS_CACHE_TAG, { expire: 0 });

  revalidateExternal(slug);
  redirect("/dashboard/external-games?ok=created");
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
    redirect(`/dashboard/external-games?error=${encodeURIComponent("Unknown game.")}`);
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
    if (blobPaths.length > 0) revalidateTag(MEDIA_CACHE_TAG, { expire: 0 });
  } catch {
    // Best-effort cleanup; the game row is already gone, which is what users see.
  }

  revalidateExternal(slug);
  redirect("/dashboard/external-games?ok=deleted");
}
