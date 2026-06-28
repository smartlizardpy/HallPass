/**
 * HallPass dashboard — game-SOURCE editing server actions.
 *
 * These actions are the role-gated successor to the old password-protected
 * `/admin/html` surface. They write each game's playable HTML into Vercel Blob
 * at the canonical path (`games/<slug>/index.html`) and then "bump" a tiny
 * version marker so clients pull the fresh source on their next poll.
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
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { blobPathForSlug } from "@/app/lib/game-html-blob";
import { GAMES_VERSION_BLOB_PATH } from "@/app/lib/games-version-blob";
import { games } from "@/app/lib/games";

/** Largest HTML payload we will accept, in characters (~2 MB of text). */
const MAX_HTML_CHARS = 2_000_000;

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
}

/**
 * Write a game's HTML to its canonical blob path, then bump the version marker.
 * Throws only if the primary `put` fails — the bump is itself best-effort — so
 * callers can wrap a single `try` around this and treat a throw as "save failed".
 */
async function writeGameHtml(slug: string, html: string): Promise<void> {
  await put(blobPathForSlug(slug), html, {
    access: "public",
    contentType: "text/html; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
  await bumpGamesVersion();
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
  await requireRole("admin");

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
  await requireRole("admin");

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

  redirect(
    saved
      ? gameTarget(slug, "ok", "Pasted HTML")
      : gameTarget(slug, "error", "Blob write failed. Try again."),
  );
}

/**
 * Clear a game's HTML, reverting it to whatever the build ships by default.
 *
 * A `del()` of an already-absent blob is treated as success (the desired
 * end-state — "no override" — is reached either way), so its `try` only guards
 * the delete and is not allowed to escape to the redirect. We still bump the
 * version marker so clients drop the stale override promptly.
 */
export async function clearHtmlAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) redirect(listErrorTarget("Choose a game first."));
  if (!isKnownSlug(slug)) redirect(listErrorTarget("Unknown game."));

  try {
    await del(blobPathForSlug(slug));
  } catch {
    // already gone — the override is absent, which is exactly what we wanted.
  }
  await bumpGamesVersion();

  redirect(gameTarget(slug, "ok", "Reset HTML to default"));
}
