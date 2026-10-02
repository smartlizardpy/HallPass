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
import { isStagedSlug } from "@/app/lib/games-store";
import { canViewStaged } from "@/app/lib/beta/staged-access";
import { injectShim } from "@/app/lib/capture/record-shim";

const MAX_PATH_SEGMENTS = 10;

/**
 * The one 404 for "no such game" AND "staged and you may not see it". They must be
 * indistinguishable, so both come from here: a denied request that differed from
 * an unknown slug by so much as a header would confirm the staged game exists.
 * `no-store` keeps a shared cache from replaying the answer to someone allowed.
 */
const NOT_FOUND = () =>
  new Response("Not found", {
    status: 404,
    headers: { "cache-control": "no-store" },
  });

/**
 * Serves any game file, preferring the FREE static twin over Vercel Blob.
 *
 * The site is blob-limited on OPERATIONS, and the old design spent one `head()`
 * per asset per request. This route now reads a single cached view of the whole
 * `games/` prefix ({@link getServingBlobMap}) — shared across every request and
 * asset — which is a Neon table rather than a Blob `list()`, so serving a game
 * costs NO billed Blob operation at all. {@link chooseGameSource} then decides,
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
 *
 * STAGED GAMES (beta-only, see `game-staging.ts`) take a stricter path. The static
 * `games.some` gate below still answers "does this game exist natively", then
 * `isStagedSlug` (a cache hit) decides whether the game is staged. Only then is
 * `canViewStaged()` — and so `auth()` — called, so a public slug keeps its exact
 * cost and cache headers. A denied request is the same 404 as an unknown slug. A
 * permitted one is served from Blob only (never the 307 to `/games/<slug>/…`,
 * which anyone could open) with `private, no-store`, so neither the CDN nor the
 * service worker keeps a copy. The blob URL itself is never sent to the client.
 *
 * RECORD MODE (`?hp-rec=1`, the game DOCUMENT only). The beta session's gameplay
 * recorder has to tap a game's Web Audio graph before the game builds it, which
 * means a script running first — and until now this route never rewrote anything,
 * because it hands the document to the static twin with a 307. In record mode the
 * route instead fetches the document (the static twin, or the blob when that is
 * what would have been served), puts the shim from `record-shim.ts` straight
 * after `<head>`, and answers 200. Every game is a single self-contained HTML
 * file, so nothing else needs routing. It runs AFTER the staged gate above, so a
 * denied request is still the one indistinguishable 404, and the injected
 * document is always `no-store` (public games included): a shared cache must never
 * hand a shimmed document to somebody who did not ask for it. Assets, and any
 * request without the query, behave exactly as before. Offline, the service
 * worker has no cached copy of the query URL and falls back to the plain static
 * twin — the game still plays and the recorder still records, minus audio and
 * SDK events.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path } = await params;
  if (!games.some((g) => g.slug === slug)) return NOT_FOUND();

  // Only a staged slug pays for auth(); see the docblock.
  const staged = await isStagedSlug(slug);
  if (staged && !(await canViewStaged())) return NOT_FOUND();

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
    staged,
  });

  if (source.kind === "missing") return NOT_FOUND();

  const recordMode =
    segments.length === 0 && new URL(req.url).searchParams.get("hp-rec") === "1";

  if (recordMode) {
    const upstreamUrl = source.kind === "static" ? staticUrl : source.url;
    const doc = await fetch(upstreamUrl, { cache: "no-store" });
    if (!doc.ok) return staged ? NOT_FOUND() : Response.redirect(staticUrl, 307);
    return new Response(injectShim(await doc.text()), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": "inline",
        "cache-control": staged ? "private, no-store" : "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

  if (source.kind === "static") {
    return Response.redirect(staticUrl, 307);
  }

  const upstream = await fetch(source.url, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    // A staged game has no public twin to fall back to.
    return staged ? NOT_FOUND() : Response.redirect(staticUrl, 307);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type":
        relPath === "index.html"
          ? "text/html; charset=utf-8"
          : contentTypeForPath(relPath),
      "content-disposition": "inline",
      "cache-control": staged
        ? "private, no-store"
        : "public, max-age=60, s-maxage=60",
      "x-content-type-options": "nosniff",
    },
  });
}
