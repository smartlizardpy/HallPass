/**
 * HallPass dashboard — game-SOURCE editing server actions.
 *
 * These actions are the role-gated successor to the old password-protected
 * `/admin/html` surface. They publish each game's playable source into Vercel
 * Blob under the game's prefix (`games/<slug>/…` — a lone `index.html` or a
 * whole multi-file bundle) and then "bump" a tiny version marker so clients
 * pull the fresh source on their next poll.
 *
 * Convergence invariant: whatever an action publishes IS the published set.
 * A bundle upload deletes blobs missing from the new zip; a single-file upload
 * is a one-file bundle and deletes leftover assets; reset deletes everything.
 *
 * INDEX INVARIANT: these are three of the four writers of `games/**` blobs, so
 * each one RECORDS what it put and FORGETS what it deleted in `game_blobs` —
 * the Neon mirror the serving route reads instead of paying for a Blob
 * `list()`. See `app/lib/game-blob-index.ts`. Indexing is best-effort in the
 * same sense the stale sweep is: the blob write is what must not be lost, and a
 * missed row degrades to serving the baked-in static twin rather than breaking
 * anything.
 *
 * Authorization model: the legacy page authenticated with a bespoke password
 * cookie (`app/lib/admin-html-auth.ts`). Here we instead gate on the dashboard's
 * own role model — `requireRole("admin")` at the top of EVERY action. That guard
 * fails closed (it redirects an unauthenticated/under-privileged caller before
 * any work happens) and re-reads the live role, so a revoked admin loses access
 * on their very next request.
 *
 * Control-flow note: `redirect()` works by THROWING a Next.js control signal, so
 * it must never sit inside a `try`/`catch` that swallows all errors. The blob
 * write is the only fallible step worth catching, so it is wrapped tightly and
 * the success/failure is reduced to a boolean; the `redirect()` that reports the
 * outcome is issued OUTSIDE that `try`.
 */

"use server";

import { del, put } from "@vercel/blob";
import { unzipSync } from "fflate";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { requireRole } from "@/app/lib/auth";
import { CREDITS_CACHE_TAG, recordFirstUpload } from "@/app/lib/game-credits";
import { GAMES_BLOB_CACHE_TAG } from "@/app/lib/game-serving-blobs";
import {
  forgetGameBlobs,
  forgetGameBlobsForSlug,
  listGameFilesLive,
  recordGameBlobs,
  type GameBlobRecord,
} from "@/app/lib/game-blob-index";
import {
  blobPathForAsset,
  blobPathForSlug,
  blobPrefixForSlug,
  contentTypeForPath,
  isSafeSegment,
} from "@/app/lib/game-html-blob";
import {
  GAMES_VERSION_BLOB_PATH,
  GAMES_VERSION_CACHE_TAG,
} from "@/app/lib/games-version-blob";
import { games } from "@/app/lib/games";

/** Largest HTML payload we will accept, in characters (~2 MB of text). */
const MAX_HTML_CHARS = 2_000_000;

/** Bundle caps — generous for real games, tight enough to blunt zip bombs. */
const MAX_BUNDLE_FILES = 300;
const MAX_BUNDLE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BUNDLE_TOTAL_BYTES = 50 * 1024 * 1024;
/** Deepest path we accept — mirrors the serving route's segment cap. */
const MAX_BUNDLE_PATH_SEGMENTS = 10;

/** True when `slug` names a game in the static catalogue. */
function isKnownSlug(slug: string): boolean {
  return games.some((g) => g.slug === slug);
}

/**
 * Build a banner redirect target for a game's CONTROL CENTER
 * (`/dashboard/games/<slug>`). Every source edit now lands back on the per-game
 * page it was issued from, not the old shared games list.
 */
function gameTarget(slug: string, key: "ok" | "error", message: string): string {
  return `/dashboard/games/${encodeURIComponent(slug)}?${key}=${encodeURIComponent(message)}`;
}

/**
 * Build a `?error=` redirect for the games INDEX. Used only for the pre-validation
 * failures (missing / unknown slug) where there is no valid per-game page to land
 * on yet.
 */
function listErrorTarget(message: string): string {
  return `/dashboard/games?error=${encodeURIComponent(message)}`;
}

/**
 * Best-effort version bump. The marker is a plain-text timestamp at a stable
 * blob path; clients poll it to discover that a game's source changed. We never
 * cache it (`cacheControlMaxAge: 0`) so a refresh is seen promptly, and we
 * swallow failures: a missed bump only delays the next poll, it must not undo a
 * successful HTML write.
 */
async function bumpGamesVersion(): Promise<void> {
  try {
    await put(GAMES_VERSION_BLOB_PATH, String(Date.now()), {
      access: "public",
      contentType: "text/plain; charset=utf-8",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
    });
  } catch {
    // best-effort; offline-refresh polling will lag until the next bump.
  }
  // The three source mutators (single/paste, bundle, reset) ALL funnel through
  // here and are the only writers of `games/**` blobs, so this is the one place
  // that must drop the serving route's cached `list()` — otherwise a just-
  // uploaded game would keep serving the pre-edit copy (or the static twin) until
  // the soft TTL rolled over. `{ expire: 0 }` for read-your-writes; not in the
  // try above because a failed sentinel write must not skip the invalidation.
  updateTag(GAMES_BLOB_CACHE_TAG);
  // Same argument for the sentinel's own cached `head()`. `/games-version` holds
  // its lookup for an hour to keep Blob spend off the polling path, so WITHOUT
  // this the bump we just wrote would stay invisible to clients for up to that
  // hour and the service worker would keep serving pre-upload game assets.
  updateTag(GAMES_VERSION_CACHE_TAG);
}

/**
 * Publish a single-file game source: write the HTML to its canonical blob path,
 * delete any OTHER blobs still under the game's prefix, then bump the version
 * marker. The sibling cleanup keeps the convergence invariant — a single-file
 * upload is a one-file bundle, so assets from a previously published bundle
 * must not stay silently published (they would keep serving, inflate the
 * dashboard file count, and get re-mirrored into the repo by sync-games).
 * Throws only if the primary `put` fails — cleanup and bump are best-effort —
 * so callers can wrap a single `try` and treat a throw as "save failed".
 */
async function writeGameHtml(slug: string, html: string): Promise<void> {
  const indexPath = blobPathForSlug(slug);
  const uploaded = await put(indexPath, html, {
    access: "public",
    contentType: "text/html; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
  try {
    // The index record comes FIRST: if the sweep below throws, the file we just
    // published is already visible to the serving route, which is the outcome
    // the admin asked for. A leftover asset is untidy; an invisible upload is a
    // bug report.
    await recordGameBlobs([
      { pathname: indexPath, url: uploaded.url, size: Buffer.byteLength(html) },
    ]);
    const stale = (await listGameFilesLive(slug))
      .map((f) => f.pathname)
      .filter((pathname) => pathname !== indexPath);
    if (stale.length > 0) {
      await del(stale);
      await forgetGameBlobs(stale);
    }
  } catch {
    // Best-effort: a leftover asset is unreferenced, not fatal; the next
    // publish (or reset) converges it.
  }
  await bumpGamesVersion();
}

/**
 * Unpack an uploaded `.zip` bundle into `relPath -> bytes`, or explain why not.
 *
 * Tolerates the common "zipped the folder" shape: when every entry lives under
 * one shared top-level directory AND that directory holds the `index.html`, the
 * prefix is stripped so the bundle still lands at the game's root. Every
 * resulting path must be servable by the game route, so each segment passes the
 * same `isSafeSegment` allowlist and the same 10-segment depth cap.
 *
 * Zip-bomb guard: the count/size caps are enforced INSIDE the unzip `filter`,
 * against the central directory's DECLARED sizes, so an oversized archive is
 * rejected before fflate allocates or inflates anything. (fflate sizes each
 * output buffer from that same declared value, so a lying header cannot
 * inflate past it either.) The post-inflate re-checks below are defense in
 * depth on the actual bytes.
 *
 * Returns the file map on success, or a human-readable error string — the
 * caller turns that string straight into an `?error=` banner.
 */
class BundleLimitError extends Error {}

function extractBundle(zipBytes: Uint8Array): Map<string, Uint8Array> | string {
  let entries: Record<string, Uint8Array>;
  let declaredCount = 0;
  let declaredTotal = 0;
  try {
    entries = unzipSync(zipBytes, {
      filter(info) {
        if (info.name.endsWith("/")) return true; // directory marker, no bytes
        declaredCount += 1;
        if (declaredCount > MAX_BUNDLE_FILES) {
          throw new BundleLimitError(
            `Too many files in zip (max ${MAX_BUNDLE_FILES}).`,
          );
        }
        if (info.originalSize > MAX_BUNDLE_FILE_BYTES) {
          throw new BundleLimitError(
            `"${info.name}" is too large (max 10MB per file).`,
          );
        }
        declaredTotal += info.originalSize;
        if (declaredTotal > MAX_BUNDLE_TOTAL_BYTES) {
          throw new BundleLimitError("Bundle too large (max 50MB unzipped).");
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof BundleLimitError) return err.message;
    return "Not a valid .zip archive.";
  }

  // Directory entries carry no bytes — only real files matter.
  const names = Object.keys(entries).filter((name) => !name.endsWith("/"));
  if (names.length === 0) return "Zip contains no files.";
  if (names.length > MAX_BUNDLE_FILES) {
    return `Too many files in zip (max ${MAX_BUNDLE_FILES}).`;
  }

  // "Zipped the folder" tolerance: strip a single shared top-level directory,
  // but only when the index.html actually lives inside it.
  let strip = "";
  const slash = names[0].indexOf("/");
  if (slash > 0) {
    const prefix = names[0].slice(0, slash + 1);
    if (
      names.every((name) => name.startsWith(prefix)) &&
      names.includes(`${prefix}index.html`)
    ) {
      strip = prefix;
    }
  }

  const files = new Map<string, Uint8Array>();
  let totalBytes = 0;
  for (const name of names) {
    if (name.includes("\\") || name.startsWith("/")) {
      return `Unsafe path in zip: "${name}".`;
    }
    const relPath = strip ? name.slice(strip.length) : name;
    const segments = relPath.split("/");
    if (segments.length > MAX_BUNDLE_PATH_SEGMENTS) {
      return `Path too deep in zip (max ${MAX_BUNDLE_PATH_SEGMENTS} segments): "${relPath}".`;
    }
    if (!segments.every(isSafeSegment)) {
      return `Unsafe path in zip: "${relPath}".`;
    }

    const data = entries[name];
    if (data.length > MAX_BUNDLE_FILE_BYTES) {
      return `"${relPath}" is too large (max 10MB per file).`;
    }
    totalBytes += data.length;
    if (totalBytes > MAX_BUNDLE_TOTAL_BYTES) {
      return "Bundle too large (max 50MB unzipped).";
    }
    files.set(relPath, data);
  }

  if (!files.has("index.html")) {
    return "Bundle must contain an index.html at its root.";
  }
  return files;
}

/**
 * Upload a game's HTML from a chosen file.
 *
 * Validation order mirrors the legacy page: confirm a known game is selected and
 * a real File is present, decode the text, then reject empty or oversized
 * payloads — each failure short-circuits via a `?error=` redirect. Only once the
 * input is sound do we attempt the blob write, whose outcome decides the final
 * banner.
 */
export async function uploadHtmlAction(formData: FormData): Promise<void> {
  const { email: actorEmail } = await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  const file = formData.get("htmlFile");

  if (!slug) redirect(listErrorTarget("Choose a game first."));
  if (!isKnownSlug(slug)) redirect(listErrorTarget("Unknown game."));
  if (!(file instanceof File)) {
    redirect(gameTarget(slug, "error", "Pick an HTML file to upload."));
  }

  const html = await file.text();
  if (!html.trim()) redirect(gameTarget(slug, "error", "Uploaded file is empty."));
  if (html.length > MAX_HTML_CHARS) {
    redirect(gameTarget(slug, "error", "File too large (max 2MB)."));
  }

  let saved = false;
  try {
    await writeGameHtml(slug, html);
    saved = true;
  } catch {
    saved = false;
  }

  // Only on a SUCCESSFUL publish, and only the first one — `recordFirstUpload`
  // is ON CONFLICT DO NOTHING, so re-uploading to fix a bug never re-attributes
  // the game. Best-effort by contract: it swallows its own errors, because a
  // missing credit line is cosmetic and a failed upload is not.
  if (saved) {
    await recordFirstUpload(slug, actorEmail);
    updateTag(CREDITS_CACHE_TAG);
  }

  redirect(
    saved
      ? gameTarget(slug, "ok", "Uploaded HTML")
      : gameTarget(slug, "error", "Blob write failed. Try again."),
  );
}

/**
 * Save a game's HTML pasted into a textarea (`html` field). Identical to
 * {@link uploadHtmlAction} except the source is the form value rather than a
 * File, so there is no File presence check.
 */
export async function pasteHtmlAction(formData: FormData): Promise<void> {
  const { email: actorEmail } = await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  const html = String(formData.get("html") ?? "");

  if (!slug) redirect(listErrorTarget("Choose a game first."));
  if (!isKnownSlug(slug)) redirect(listErrorTarget("Unknown game."));
  if (!html.trim()) redirect(gameTarget(slug, "error", "HTML is empty."));
  if (html.length > MAX_HTML_CHARS) {
    redirect(gameTarget(slug, "error", "HTML too large (max 2MB)."));
  }

  let saved = false;
  try {
    await writeGameHtml(slug, html);
    saved = true;
  } catch {
    saved = false;
  }

  // Only on a SUCCESSFUL publish, and only the first one — `recordFirstUpload`
  // is ON CONFLICT DO NOTHING, so re-uploading to fix a bug never re-attributes
  // the game. Best-effort by contract: it swallows its own errors, because a
  // missing credit line is cosmetic and a failed upload is not.
  if (saved) {
    await recordFirstUpload(slug, actorEmail);
    updateTag(CREDITS_CACHE_TAG);
  }

  redirect(
    saved
      ? gameTarget(slug, "ok", "Pasted HTML")
      : gameTarget(slug, "error", "Blob write failed. Try again."),
  );
}

/**
 * Upload a whole multi-file game as a `.zip` bundle.
 *
 * Validation mirrors {@link uploadHtmlAction} (known slug, real File), then the
 * archive is unpacked and vetted by {@link extractBundle} — any string it
 * returns short-circuits into an `?error=` banner. Only a sound bundle touches
 * blob storage: every extracted file is written under the game's prefix, then
 * any previously published blob whose path is NOT in the new bundle is deleted,
 * so the published set converges on exactly the bundle's contents.
 */
export async function uploadBundleAction(formData: FormData): Promise<void> {
  const { email: actorEmail } = await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  const file = formData.get("bundleFile");

  if (!slug) redirect(listErrorTarget("Choose a game first."));
  if (!isKnownSlug(slug)) redirect(listErrorTarget("Unknown game."));
  if (!(file instanceof File)) {
    redirect(gameTarget(slug, "error", "Pick a .zip bundle to upload."));
  }

  const zipBytes = new Uint8Array(await file.arrayBuffer());
  if (zipBytes.length === 0) {
    redirect(gameTarget(slug, "error", "Uploaded file is empty."));
  }

  const bundle = extractBundle(zipBytes);
  if (typeof bundle === "string") redirect(gameTarget(slug, "error", bundle));

  let saved = false;
  try {
    // Snapshot BEFORE writing so we know which old blobs become stale.
    const existing = await listGameFilesLive(slug);

    const published: GameBlobRecord[] = [];
    for (const [relPath, data] of bundle) {
      const pathname = blobPathForAsset(slug, relPath);
      const uploaded = await put(pathname, Buffer.from(data), {
        access: "public",
        contentType: contentTypeForPath(relPath),
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
      published.push({ pathname, url: uploaded.url, size: data.length });
    }
    // ONE statement for the whole bundle, after every `put` has resolved: a
    // 300-file zip would otherwise pay 300 sequential Neon round trips on top
    // of its 300 blob writes.
    await recordGameBlobs(published);

    const prefix = blobPrefixForSlug(slug);
    const stale = existing
      .map((f) => f.pathname)
      .filter((pathname) => !bundle.has(pathname.slice(prefix.length)));
    if (stale.length > 0) {
      await del(stale);
      await forgetGameBlobs(stale);
    }

    await bumpGamesVersion();
    saved = true;
  } catch {
    saved = false;
  }

  if (saved) {
    await recordFirstUpload(slug, actorEmail);
    updateTag(CREDITS_CACHE_TAG);
  }

  redirect(
    saved
      ? gameTarget(slug, "ok", `Uploaded bundle (${bundle.size} file${bundle.size === 1 ? "" : "s"})`)
      : gameTarget(slug, "error", "Blob write failed. Try again."),
  );
}

/**
 * Clear a game's SOURCE, reverting it to whatever the build ships by default.
 *
 * Multi-file aware: deletes every blob under the game's prefix (index.html plus
 * any bundle assets), not just the canonical HTML path. Failures inside the
 * `try` are treated as success — the desired end-state, "no override", is
 * reached either way — and are not allowed to escape to the redirect. We still
 * bump the version marker so clients drop the stale override promptly.
 */
export async function clearHtmlAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) redirect(listErrorTarget("Choose a game first."));
  if (!isKnownSlug(slug)) redirect(listErrorTarget("Unknown game."));

  try {
    const files = await listGameFilesLive(slug);
    if (files.length > 0) await del(files.map((f) => f.pathname));
    // By slug, not by the paths we just read: reset means "this game has no
    // override", so any row the listing missed must go too rather than linger
    // as a pointer to a blob that is no longer there.
    await forgetGameBlobsForSlug(slug);
  } catch {
    // already gone — the override is absent, which is exactly what we wanted.
  }
  await bumpGamesVersion();

  redirect(gameTarget(slug, "ok", "Reset source to default"));
}
