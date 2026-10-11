/**
 * The gallery's slide order: video first, then the cover, then the screenshots.
 */

import { describe, expect, it } from "vitest";
import type { GameMedia } from "./game-media-blob";
import { buildGallerySlides, firstImageIndex } from "./gallery-slides";

const shot = (id: string, alt = ""): GameMedia => ({
  id,
  slug: "g",
  kind: "screenshot",
  blobPath: `game-media/g/${id}.webp`,
  blobUrl: null,
  contentType: "image/webp",
  width: 1280,
  height: 800,
  bytes: 1000,
  alt,
  position: 0,
});

const video = { id: "dQw4w9WgXcQ", label: "Gameplay" };
const keys = (s: ReturnType<typeof buildGallerySlides>) => s.map((x) => x.key);

describe("buildGallerySlides", () => {
  it("puts the video first, then the cover, then the screenshots", () => {
    const slides = buildGallerySlides({
      title: "Snake",
      cover: "/games/snake/cover.png",
      media: [shot("a"), shot("b")],
      video,
    });
    expect(keys(slides)).toEqual(["video", "cover", "a", "b"]);
    expect(slides[0]).toMatchObject({ kind: "video", label: "Gameplay", videoId: video.id });
    expect(slides.slice(1).every((s) => s.kind === "image")).toBe(true);
  });

  it("is unchanged for a game with no video", () => {
    const slides = buildGallerySlides({
      title: "Snake",
      cover: "/c.png",
      media: [shot("a")],
      video: null,
    });
    expect(keys(slides)).toEqual(["cover", "a"]);
  });

  it("leaves out a cover the game does not have", () => {
    const slides = buildGallerySlides({ title: "Snake", cover: null, media: [shot("a")], video });
    expect(keys(slides)).toEqual(["video", "a"]);
  });

  it("is just the video when there is nothing else", () => {
    const slides = buildGallerySlides({ title: "Snake", cover: null, media: [], video });
    expect(keys(slides)).toEqual(["video"]);
  });

  it("is empty for a game with nothing at all", () => {
    expect(buildGallerySlides({ title: "Snake", cover: null, media: [], video: null })).toEqual([]);
  });

  it("writes accessible names, preferring a stored alt over a generated one", () => {
    const slides = buildGallerySlides({
      title: "Snake",
      cover: "/c.png",
      media: [shot("a", "Level two"), shot("b")],
      video: null,
    });
    const alts = slides.map((s) => (s.kind === "image" ? s.alt : null));
    expect(alts).toEqual(["Snake cover art", "Level two", "Snake screenshot 2"]);
  });
});

describe("firstImageIndex", () => {
  it("skips the video", () => {
    const slides = buildGallerySlides({ title: "S", cover: "/c.png", media: [], video });
    expect(firstImageIndex(slides)).toBe(1);
  });

  it("is 0 when the first slide is already a picture, or when there is none", () => {
    const pics = buildGallerySlides({ title: "S", cover: "/c.png", media: [], video: null });
    expect(firstImageIndex(pics)).toBe(0);
    expect(firstImageIndex([])).toBe(0);
  });
});
