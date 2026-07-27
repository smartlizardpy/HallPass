"use server";

/**
 * HallPass dashboard — per-game MEDIA (screenshot) server actions.
 *
 * Its own file rather than growing `actions.ts`, matching how source-code actions
 * already live in `../actions.ts` and override actions in `./actions.ts`. These
 * own the `game_media` table and the `game-media/<slug>/` Vercel Blob prefix.
 *
 * Authorization + control flow mirror the rest of the dashboard: `requireRole
 * ("admin")` first, the fallible work in a try/catch reduced to a flag, and every
 * `redirect()` OUTSIDE that try — `redirect` signals by throwing a control object
 * that a catch-all would swallow.
 *
 * TWO THINGS THAT DIFFER FROM THE SOURCE-CODE ACTIONS, both deliberate:
 *
 * 1. THESE MUST NOT CALL `bumpGamesVersion()`. That sentinel makes every online
 *    client re-fetch EVERY `/game-html/` URL with `cache: "no-store"` — the whole
 *    game corpus (megabytes of bundles) re-downloaded because an admin uploaded a
 *    200 KB screenshot. Screenshot freshness is page data, so it rides on
 *    `revalidateTag` + `revalidatePath` like every other dashboard edit, and the
 *    service worker picks new media up through ordinary `cacheFirst` runtime
 *    caching on the next online visit.
 *
 * 2. THE SLUG IS VALIDATED WITH `isResolvedSlug`, NOT AGAINST THE STATIC ARRAY.
 *    An external (off-site) game has no bundled `cover.png`, so it is precisely
 *    the kind of game that needs uploaded screenshots. `app/lib/favorites.ts`
 *    validates against the static array and therefore silently drops external
 *    slugs; that bug must not be reproduced here.
 */

import { del, put } from "@vercel/blob";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { isResolvedSlug } from "@/app/lib/games-store";
import {
  MEDIA_CACHE_TAG,
  countMediaForSlug,
  deleteMedia,
  insertMedia,
  mediaBlobPath,
  reorderMedia,
  setMediaAlt,
} from "@/app/lib/game-media";
import {
  MAX_MEDIA_PER_SLUG,
  MAX_MEDIA_PER_UPLOAD,
  validateMediaUpload,
  type MediaRejection,
} from "@/app/lib/image-meta";

/** Alt text is a short accessibility label, not a caption. */
const MAX_ALT_LENGTH = 160;

/** Human copy for each machine reason, so the banner never reflects raw input. */
const REJECTION_MESSAGES: Record<MediaRejection, string> = {
  empty: "that file was empty",
  "too-large": "that file is over 4 MB",
  "not-an-image": "that isn't a PNG, JPEG or WebP",
  "too-narrow": "that image is under 640px wide",
  "bad-aspect": "that image is too tall or too wide (needs to be landscape-ish)",
};

function gameUrl(slug: string, query: string): string {
  return `/dashboard/games/${encodeURIComponent(slug)}?${query}`;
}
const ok = (slug: string, msg: string) =>
  gameUrl(slug, `ok=${encodeURIComponent(msg)}`);
const err = (slug: string, msg: string) =>
  gameUrl(slug, `error=${encodeURIComponent(msg)}`);

/**
 * Invalidate the media cache plus the one public route that renders it. Narrow on
 * purpose: media changes affect a single game's store page, so there is no reason
 * to touch `/`, the sitemap or the LLM manifest the way a copy edit does.
 */
function revalidateMedia(slug: string): void {
  // Two-arg `{ expire: 0 }` form — the single-arg call is deprecated in this
  // Next.js, and immediate expiry is what gives the admin read-your-own-writes.
  revalidateTag(MEDIA_CACHE_TAG, { expire: 0 });
  revalidatePath(`/game/${slug}`);
}

/** Blob-safe random id; also the filename stem, so it must match the slug CHECK. */
function newMediaId(): string {
  return `m${crypto.randomUUID().replace(/-/g, "")}`;
}

/**
 * Upload one or more screenshots.
 *
 * Every file is sniffed from its BYTES (`validateMediaUpload`) rather than
 * trusted via `File.type`, which is attacker-controlled. The per-game cap is
 * re-read here rather than assumed from the rendered page, so two admins
 * uploading at once cannot jointly exceed it.
 *
 * Partial success is reported honestly: files that pass are stored and the
 * banner names how many were skipped and why, instead of failing the whole
 * submission because one image was portrait.
 */
export async function uploadMediaAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) redirect("/dashboard/games?error=Unknown+game");
  if (!(await isResolvedSlug(slug))) redirect("/dashboard/games?error=Unknown+game");

  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (files.length === 0) redirect(err(slug, "Choose at least one image"));
  if (files.length > MAX_MEDIA_PER_UPLOAD) {
    redirect(err(slug, `Upload at most ${MAX_MEDIA_PER_UPLOAD} images at a time`));
  }

  let failure: string | null = null;
  let stored = 0;
  const skipped: string[] = [];

  try {
    const existing = await countMediaForSlug(slug);
    const room = MAX_MEDIA_PER_SLUG - existing;
    if (room <= 0) {
      failure = `This game already has the maximum of ${MAX_MEDIA_PER_SLUG} images`;
    } else {
      for (const file of files.slice(0, room)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const check = validateMediaUpload(bytes);
        if (!check.ok) {
          skipped.push(`${file.name} — ${REJECTION_MESSAGES[check.reason]}`);
          continue;
        }

        const id = newMediaId();
        const blobPath = mediaBlobPath(slug, id, check.meta.type);
        // The `File` is uploaded, not the `Uint8Array` we validated — `put`
        // takes a stream-like body, and the two are the same bytes. The
        // content type is the SNIFFED one, never `file.type`, so a mislabelled
        // upload is stored under what it actually is.
        //
        // `allowOverwrite: false` + a random id is what makes the served URL
        // content-stable, which is what justifies the `immutable` cache header on
        // the serving route.
        await put(blobPath, file, {
          access: "public",
          contentType: check.meta.type,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 31_536_000,
        });
        await insertMedia({
          id,
          slug,
          kind: "screenshot",
          blobPath,
          contentType: check.meta.type,
          width: check.meta.width,
          height: check.meta.height,
          bytes: check.bytes,
        });
        stored += 1;
      }
      if (files.length > room) {
        skipped.push(
          `${files.length - room} not uploaded — only ${MAX_MEDIA_PER_SLUG} images per game`,
        );
      }
    }
  } catch {
    failure = "Could not upload images";
  }

  if (failure) redirect(err(slug, failure));

  revalidateMedia(slug);
  if (stored === 0) {
    redirect(err(slug, `Nothing uploaded: ${skipped.join("; ")}`));
  }
  redirect(
    ok(
      slug,
      skipped.length
        ? `Uploaded ${stored}; skipped ${skipped.length} (${skipped.join("; ")})`
        : `Uploaded ${stored} image${stored === 1 ? "" : "s"}`,
    ),
  );
}

/**
 * Remove one screenshot: the row first, then the object.
 *
 * That order is the safe one. Losing the blob delete leaks one orphaned object
 * (invisible, since the serving route only streams objects with a matching row).
 * Deleting the blob first and then failing the row delete would leave a row
 * pointing at a 404 — a visibly broken gallery. The blob delete is best-effort
 * for the same reason.
 */
export async function deleteMediaAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  const id = String(formData.get("id") ?? "").trim();
  if (!slug || !id) redirect("/dashboard/games?error=Unknown+game");

  let failed = false;
  try {
    const blobPath = await deleteMedia(id);
    if (blobPath) {
      await del(blobPath).catch(() => {
        /* orphaned object; the row is gone, which is what users see */
      });
    }
  } catch {
    failed = true;
  }
  if (failed) redirect(err(slug, "Could not delete that image"));

  revalidateMedia(slug);
  redirect(ok(slug, "Image deleted"));
}

/**
 * Rewrite the gallery order from the submitted id sequence.
 *
 * The form emits one hidden `ids` field per image in its new order and we read
 * them with `getAll` — the same one-field-per-item convention `_ui/TagEditor`
 * uses for tags. The whole reorder is a single bound-array statement in
 * `reorderMedia`, scoped to this slug so foreign ids are ignored rather than
 * letting one game reorder another's rows.
 */
export async function reorderMediaAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) redirect("/dashboard/games?error=Unknown+game");

  const ids = formData
    .getAll("ids")
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (ids.length === 0) redirect(err(slug, "Nothing to reorder"));

  let failed = false;
  try {
    await reorderMedia(slug, ids);
  } catch {
    failed = true;
  }
  if (failed) redirect(err(slug, "Could not save the new order"));

  revalidateMedia(slug);
  redirect(ok(slug, "Order saved"));
}

/**
 * Set one image's alt text. Trimmed and capped; empty is legitimate (decorative)
 * and stores an empty string rather than NULL, matching the column's NOT NULL
 * DEFAULT ''.
 */
export async function setMediaAltAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  const id = String(formData.get("id") ?? "").trim();
  if (!slug || !id) redirect("/dashboard/games?error=Unknown+game");

  const alt = String(formData.get("alt") ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ALT_LENGTH);

  let failed = false;
  try {
    await setMediaAlt(id, alt);
  } catch {
    failed = true;
  }
  if (failed) redirect(err(slug, "Could not save that description"));

  revalidateMedia(slug);
  redirect(ok(slug, "Description saved"));
}
