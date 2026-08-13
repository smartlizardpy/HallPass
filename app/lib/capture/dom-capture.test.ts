/**
 * Tests for the pure half of `dom-capture.ts`.
 *
 * The DOM half needs a real canvas with a real rasteriser, which jsdom does not
 * have — so what is testable here is the two decisions that actually go wrong in
 * practice: WHICH canvas is the game, and what size the still comes out. Both are
 * plain arithmetic over plain objects, and both are where a wrong answer is
 * silent rather than loud.
 */

import { describe, expect, it } from "vitest";
import { MIN_CANVAS_AREA, pickGameCanvas } from "./dom-capture";

/** A candidate whose backing store and rendered size agree, as most do. */
function visible(width: number, height: number) {
  return { width, height, renderedWidth: width, renderedHeight: height };
}

describe("pickGameCanvas", () => {
  it("returns null when a game has no canvas at all", () => {
    expect(pickGameCanvas([])).toBeNull();
  });

  it("picks the biggest visible canvas", () => {
    const small = visible(320, 240);
    const big = visible(1280, 720);
    expect(pickGameCanvas([small, big])).toBe(big);
    expect(pickGameCanvas([big, small])).toBe(big);
  });

  /**
   * The case this function exists for. A game that renders into a large offscreen
   * buffer and blits a scaled copy to the visible canvas would otherwise hand the
   * tester a picture of the buffer — which may be a frame ahead, a frame behind,
   * or a compositing layer the player never saw.
   */
  it("prefers a visible canvas over a larger offscreen one", () => {
    const offscreen = { width: 4096, height: 4096, renderedWidth: 0, renderedHeight: 0 };
    const onscreen = visible(800, 600);
    expect(pickGameCanvas([offscreen, onscreen])).toBe(onscreen);
  });

  it("ignores the scratch canvases games keep for atlases and text", () => {
    const scratch = visible(16, 16);
    expect(scratch.width * scratch.height).toBeLessThan(MIN_CANVAS_AREA);
    expect(pickGameCanvas([scratch])).toBeNull();
  });

  it("keeps the first of two equal layers, which is document order", () => {
    const back = visible(800, 600);
    const front = visible(800, 600);
    expect(pickGameCanvas([back, front])).toBe(back);
  });
});

