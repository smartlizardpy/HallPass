/**
 * HallPass — game media types and path helpers.
 *
 * Deliberately has NO `import "server-only"` and touches no database: the store
 * page's gallery is a client component and needs the `GameMedia` shape and the
 * public URL for a row. Keeping these here mirrors `game-html-blob.ts`, which
 * splits path helpers away from the route that streams the bytes, and it means
 * importing a URL helper can never drag the Neon client into a browser bundle.
 *
 * The database access lives in `game-media.ts`, which IS server-only.
 */

import { extensionForType, type ImageType } from "@/app/lib/image-meta";

export type GameMediaKind = "screenshot" | "hero";

export type GameMedia = {
  id: string;
  slug: string;
  kind: GameMediaKind;
  /** Blob key, which doubles as the same-origin URL path. */
  blobPath: string;
  contentType: ImageType;
  width: number;
  height: number;
  bytes: number;
  alt: string;
  position: number;
};

/**
 * The Vercel Blob prefix for a game's media.
 *
 * NEVER `games/<slug>/`. Three dashboard actions delete that prefix wholesale,
 * `scripts/sync-games.mjs` mirrors it into `public/games/` (i.e. into the repo),
 * and `scripts/build-sw-manifest.mjs` precaches everything mirrored — so
 * screenshots stored there would be deleted by an unrelated source upload,
 * committed into git, and force-downloaded onto every visitor's device. See
 * `app/lib/game-media.sql` for the full list.
 */
export function mediaBlobPrefix(slug: string): string {
  return `game-media/${slug}/`;
}

/** The blob key for one image. `id` is random, so the key is content-stable. */
export function mediaBlobPath(
  slug: string,
  id: string,
  type: ImageType,
): string {
  return `${mediaBlobPrefix(slug)}${id}.${extensionForType(type)}`;
}

/**
 * The public, same-origin URL for a media row.
 *
 * Same-origin is not cosmetic. `public/sw.js` returns early for cross-origin
 * requests, and its `isCacheable()` requires `res.type === "basic" || "default"`,
 * so a raw Vercel Blob URL can NEVER be cached by the service worker. Serving
 * through our own `/game-media/` route puts screenshots in the `cacheFirst`
 * branch, which is what makes them available offline after one online visit.
 */
export function mediaPublicPath(media: Pick<GameMedia, "blobPath">): string {
  return `/${media.blobPath}`;
}
