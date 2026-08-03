import { notFound } from "next/navigation";
import {
  blobPathForAsset,
  chooseGameSource,
  contentTypeForPath,
  isSafeSegment,
} from "@/app/lib/game-html-blob";
import { getServingBlobMap } from "@/app/lib/game-serving-blobs";
import { STATIC_GAME_FILES } from "@/app/lib/static-games-manifest";
import { MIRROR_SYNCED_AT } from "@/app/lib/mirror-synced-at";
import { games } from "@/app/lib/games";

const MAX_PATH_SEGMENTS = 10;

/**
 * Serves any game file, preferring the FREE static twin over Vercel Blob.
 *
 * The site is blob-limited on OPERATIONS, and the old design spent one `head()`
 * per asset per request. This route now reads a single cached `list()` of the
 * whole `games/` prefix ({@link getServingBlobMap}) — shared across every request
 * and asset — and never calls `head()`. {@link chooseGameSource} then decides,
 * per asset, between the CDN twin and a Blob proxy:
 *
 * - A blob uploaded SINCE the last sync (`uploadedAt > MIRROR_SYNCED_AT`) is
 *   newer than the deployed mirror, so it is proxied and the edit is live now.
 * - Anything already baked into `public/games/` is 307'd to that static path, so
 *   the iframe's document URL becomes `/games/<slug>/…` and every relative asset
 *   loads straight off the CDN without touching this route again.
 *
 * The 307-to-static branch is the exact path the service worker already handles
 * for reset/absent games (opaqueredirect → serve the precached twin), so offline
 * play is unaffected.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path } = await params;
  if (!games.some((g) => g.slug === slug)) notFound();

  const segments = path ?? [];
  if (segments.length > MAX_PATH_SEGMENTS || !segments.every(isSafeSegment)) {
    return new Response("Bad path", { status: 400 });
  }
  // Empty path = the game document itself; non-empty = a bundled asset.
  const relPath = segments.length === 0 ? "index.html" : segments.join("/");

  const origin = new URL(req.url).origin;
  const staticUrl = `${origin}/games/${slug}/${
    segments.length === 0
      ? "index.html"
      : segments.map(encodeURIComponent).join("/")
  }`;

  const blob = (await getServingBlobMap()).get(blobPathForAsset(slug, relPath)) ?? null;

  const source = chooseGameSource({
    staticExists: STATIC_GAME_FILES.has(`${slug}/${relPath}`),
    blob,
    mirrorSyncedAt: MIRROR_SYNCED_AT,
  });

  if (source.kind === "static") {
    return Response.redirect(staticUrl, 307);
  }

  const upstream = await fetch(source.url, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return Response.redirect(staticUrl, 307);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type":
        relPath === "index.html"
          ? "text/html; charset=utf-8"
          : contentTypeForPath(relPath),
      "content-disposition": "inline",
      "cache-control": "public, max-age=60, s-maxage=60",
      "x-content-type-options": "nosniff",
    },
  });
}
