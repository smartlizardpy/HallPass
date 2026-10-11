/**
 * What the store-page gallery shows, in order.
 *
 * The gameplay video used to sit behind a separate Gameplay / Screenshots toggle
 * above the hero; it is now just the FIRST SLIDE of the gallery, so the strip, the
 * counter, the arrows and the swipe are one thing instead of two. The order is a
 * rule, not an accident of render order, and it lives here so the main frame, the
 * thumb strip, the counter and the lightbox cannot disagree about what slide 1 is:
 *
 *   1. the video, when the game has one — it answers "what is this like to play",
 *      which a still cannot, and it was already what the page led with;
 *   2. the cover art;
 *   3. the screenshots, in the order they were stored.
 *
 * Pure and DOM-free, like `tab-gate.ts`, so the order is unit-tested.
 */

import { type GameMedia, mediaPublicPath } from "./game-media-blob";

export type ImageSlide = {
  kind: "image";
  key: string;
  src: string;
  alt: string;
  /** Absent for the cover, whose intrinsic size is not recorded anywhere. */
  width?: number;
  height?: number;
};

export type VideoSlide = {
  kind: "video";
  key: "video";
  /** Editorial label — "Gameplay", "Intro". */
  label: string;
  videoId: string;
};

export type GallerySlide = ImageSlide | VideoSlide;

export function buildGallerySlides({
  title,
  cover,
  media,
  video,
}: {
  title: string;
  /** Cover art URL, or `null` when the game has none. */
  cover: string | null;
  media: GameMedia[];
  /** A validated 11-character YouTube id and its label, or `null`. */
  video: { id: string; label: string } | null;
}): GallerySlide[] {
  return [
    ...(video
      ? [{ kind: "video" as const, key: "video" as const, label: video.label, videoId: video.id }]
      : []),
    ...(cover
      ? [{ kind: "image" as const, key: "cover", src: cover, alt: `${title} cover art` }]
      : []),
    ...media.map((item, i) => ({
      kind: "image" as const,
      key: item.id,
      src: mediaPublicPath(item),
      alt: item.alt || `${title} screenshot ${i + 1}`,
      width: item.width,
      height: item.height,
    })),
  ];
}

/** The slide to land on when someone leaves the video: the first picture. */
export function firstImageIndex(slides: GallerySlide[]): number {
  const i = slides.findIndex((s) => s.kind === "image");
  return i === -1 ? 0 : i;
}
