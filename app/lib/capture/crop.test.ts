import { describe, expect, it } from "vitest";
import {
  averageHash,
  centreCrop,
  DUPLICATE_HASH_DISTANCE,
  hammingDistance,
  isBlankFrame,
  isDuplicateOf,
  luminanceStats,
  mapRectToFrame,
  MIN_FRAME_VARIANCE,
} from "./crop";
import {
  DEFAULT_CAPTURE_ASPECT,
  DEFAULT_CAPTURE_WIDTH,
} from "./tab-capture";

/** Build an RGBA buffer from a per-pixel grey value function. */
function rgba(count: number, grey: (i: number) => number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i += 1) {
    const v = grey(i);
    buf[i * 4] = v;
    buf[i * 4 + 1] = v;
    buf[i * 4 + 2] = v;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

describe("mapRectToFrame", () => {
  it("is identity when the frame matches the viewport", () => {
    const rect = { x: 10, y: 20, width: 300, height: 200 };
    expect(
      mapRectToFrame(rect, { width: 1000, height: 800 }, { width: 1000, height: 800 }),
    ).toEqual(rect);
  });

  it("scales up for a HiDPI capture", () => {
    // The browser captured at 2x. The iframe's CSS rect must scale with it, or
    // the crop would take the top-left quarter of the game and call it a cover.
    expect(
      mapRectToFrame(
        { x: 100, y: 50, width: 400, height: 300 },
        { width: 1000, height: 800 },
        { width: 2000, height: 1600 },
      ),
    ).toEqual({ x: 200, y: 100, width: 800, height: 600 });
  });

  it("handles a non-uniform scale on each axis", () => {
    expect(
      mapRectToFrame(
        { x: 10, y: 10, width: 100, height: 100 },
        { width: 1000, height: 500 },
        { width: 2000, height: 500 },
      ),
    ).toEqual({ x: 20, y: 10, width: 200, height: 100 });
  });

  it("clamps a rect that starts off-screen", () => {
    // A scrolled-away iframe reports a negative y. drawImage throws on that.
    const out = mapRectToFrame(
      { x: -50, y: -80, width: 400, height: 300 },
      { width: 1000, height: 800 },
      { width: 1000, height: 800 },
    );
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it("never lets the crop run past the frame", () => {
    const frame = { width: 1000, height: 800 };
    const out = mapRectToFrame(
      { x: 900, y: 700, width: 400, height: 400 },
      { width: 1000, height: 800 },
      frame,
    );
    expect(out.x + out.width).toBeLessThanOrEqual(frame.width);
    expect(out.y + out.height).toBeLessThanOrEqual(frame.height);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });

  it("falls back to the whole frame for a degenerate viewport", () => {
    expect(
      mapRectToFrame({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 }, { width: 640, height: 480 }),
    ).toEqual({ x: 0, y: 0, width: 640, height: 480 });
  });
});

describe("centreCrop", () => {
  const COVER_ASPECT = 659 / 613;

  it("trims the sides of a widescreen frame", () => {
    const out = centreCrop({ width: 1920, height: 1080 }, COVER_ASPECT);
    expect(out.height).toBe(1080);
    expect(out.width).toBeLessThan(1920);
    expect(out.y).toBe(0);
    // Centred to within a pixel. Exact centring is impossible when the leftover
    // is odd (1920 - 1161 = 759), and the invariant that actually matters is
    // the fit assertion below.
    expect(Math.abs(out.x * 2 + out.width - 1920)).toBeLessThanOrEqual(1);
  });

  it("trims the top and bottom of a portrait frame", () => {
    const out = centreCrop({ width: 720, height: 1280 }, COVER_ASPECT);
    expect(out.width).toBe(720);
    expect(out.height).toBeLessThan(1280);
    expect(out.x).toBe(0);
    expect(Math.abs(out.y * 2 + out.height - 1280)).toBeLessThanOrEqual(1);
  });

  it("never runs past the source edge", () => {
    // The load-bearing property: drawImage answers an over-wide crop with a
    // transparent column rather than an error, so it would ship as a hairline
    // artefact down the side of a cover instead of failing loudly.
    for (const source of [
      { width: 1920, height: 1080 },
      { width: 1921, height: 1081 },
      { width: 1280, height: 720 },
      { width: 391, height: 843 },
      { width: 659, height: 613 },
      { width: 1000, height: 999 },
    ]) {
      const out = centreCrop(source, COVER_ASPECT);
      expect(out.x).toBeGreaterThanOrEqual(0);
      expect(out.y).toBeGreaterThanOrEqual(0);
      expect(out.x + out.width).toBeLessThanOrEqual(source.width);
      expect(out.y + out.height).toBeLessThanOrEqual(source.height);
    }
  });

  it("produces the requested aspect within a pixel of rounding", () => {
    for (const source of [
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
      { width: 800, height: 600 },
      { width: 390, height: 844 },
    ]) {
      const out = centreCrop(source, COVER_ASPECT);
      expect(Math.abs(out.width / out.height - COVER_ASPECT)).toBeLessThan(0.01);
    }
  });

  it("never returns a zero-sized rect", () => {
    const out = centreCrop({ width: 1, height: 1000 }, COVER_ASPECT);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });
});

describe("captured stills always satisfy validateMediaUpload", () => {
  // The policy an accepted shot must pass here AND again on its way into
  // game_media. Mirrored rather than imported so a change to either side shows
  // up as a failure here instead of as silently rejected screenshots.
  const MIN_ASPECT = 1.2;
  const MAX_ASPECT = 2.2;
  const MIN_WIDTH = 640;

  // Every iframe shape a real session produces: full width, narrowed by the
  // report panel, narrowed by the review panel, a phone, a short window. The
  // 1.12 case is the regression — it is what the report panel actually creates,
  // and it was rejected as `bad-aspect` on every grab.
  const IFRAME_SHAPES = [
    { width: 1280, height: 800 },
    { width: 896, height: 800 },
    { width: 640, height: 570 },
    { width: 390, height: 700 },
    { width: 1600, height: 400 },
    { width: 300, height: 900 },
  ];

  it("lands inside the accepted aspect band whatever the window", () => {
    for (const shape of IFRAME_SHAPES) {
      const inner = centreCrop(shape, DEFAULT_CAPTURE_ASPECT);
      // The stored image is drawn at a FIXED size, not at the crop's size —
      // that is what makes the guarantee hold for a tiny source too.
      const outW = DEFAULT_CAPTURE_WIDTH;
      const outH = Math.round(outW / DEFAULT_CAPTURE_ASPECT);
      const aspect = outW / outH;

      expect(outW).toBeGreaterThanOrEqual(MIN_WIDTH);
      expect(aspect).toBeGreaterThanOrEqual(MIN_ASPECT);
      expect(aspect).toBeLessThanOrEqual(MAX_ASPECT);
      // And the crop itself must still be a real rectangle inside the source.
      expect(inner.width).toBeGreaterThan(0);
      expect(inner.height).toBeGreaterThan(0);
      expect(inner.x + inner.width).toBeLessThanOrEqual(shape.width);
      expect(inner.y + inner.height).toBeLessThanOrEqual(shape.height);
    }
  });

  it("keeps the default aspect clear of both band edges", () => {
    // Not merely inside the band — far enough in that rounding cannot push a
    // shot out of it.
    expect(DEFAULT_CAPTURE_ASPECT).toBeGreaterThan(MIN_ASPECT + 0.3);
    expect(DEFAULT_CAPTURE_ASPECT).toBeLessThan(MAX_ASPECT - 0.3);
  });
});

describe("luminanceStats", () => {
  it("reports zero variance for a flat fill", () => {
    expect(luminanceStats(rgba(256, () => 128)).variance).toBeCloseTo(0, 6);
  });

  it("reports a high mean for white and low for black", () => {
    expect(luminanceStats(rgba(256, () => 255)).mean).toBeCloseTo(1, 2);
    expect(luminanceStats(rgba(256, () => 0)).mean).toBeCloseTo(0, 2);
  });

  it("reports real variance for a checkerboard", () => {
    const stats = luminanceStats(rgba(256, (i) => (i % 2 ? 255 : 0)), 1);
    expect(stats.variance).toBeGreaterThan(0.2);
  });
});

describe("isBlankFrame", () => {
  it("rejects a solid black loading screen", () => {
    expect(isBlankFrame(rgba(1024, () => 0))).toBe(true);
  });

  it("rejects a solid white screen", () => {
    // Brightness alone would have kept this; variance is what catches it.
    expect(isBlankFrame(rgba(1024, () => 255))).toBe(true);
  });

  it("keeps a dark frame that still has detail in it", () => {
    // A legitimately dark game must survive — this is the case a brightness
    // threshold would have thrown away.
    expect(isBlankFrame(rgba(1024, (i) => (i % 7 === 0 ? 90 : 8)))).toBe(false);
  });

  it("keeps a busy frame", () => {
    expect(isBlankFrame(rgba(1024, (i) => (i * 37) % 256))).toBe(false);
  });

  it("uses a threshold above a near-flat gradient", () => {
    // A gentle splash gradient should still count as blank.
    const gradient = rgba(1024, (i) => 120 + Math.floor(i / 128));
    expect(luminanceStats(gradient).variance).toBeLessThan(MIN_FRAME_VARIANCE);
  });
});

/** A 64-entry hash from a bit-per-cell pattern, for the distance assertions. */
function hash(bits: (i: number) => number): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, i) => (bits(i) ? 1 : 0));
}

describe("averageHash / hammingDistance", () => {
  const flat = new Uint8ClampedArray(64).fill(100);
  const half = new Uint8ClampedArray(64).map((_, i) => (i < 32 ? 10 : 200));

  it("gives a flat image an all-zero hash", () => {
    // Nothing is strictly above the mean when every cell equals it.
    expect(Array.from(averageHash(flat)).every((b) => b === 0)).toBe(true);
  });

  it("is stable for the same input", () => {
    expect(Array.from(averageHash(half))).toEqual(Array.from(averageHash(half)));
  });

  it("distances a picture from itself at zero", () => {
    expect(hammingDistance(averageHash(half), averageHash(half))).toBe(0);
  });

  it("distances two different pictures", () => {
    const inverted = new Uint8ClampedArray(64).map((_, i) => (i < 32 ? 200 : 10));
    expect(
      hammingDistance(averageHash(half), averageHash(inverted)),
    ).toBeGreaterThan(DUPLICATE_HASH_DISTANCE);
  });

  it("counts differing cells correctly", () => {
    expect(hammingDistance(hash(() => 0), hash((i) => (i < 3 ? 1 : 0)))).toBe(3);
    expect(hammingDistance(hash(() => 0), hash(() => 1))).toBe(64);
  });
});

describe("isDuplicateOf", () => {
  it("is false against an empty set", () => {
    expect(isDuplicateOf(hash((i) => i % 2), [])).toBe(false);
  });

  it("catches a near-identical frame", () => {
    // One cell different — a paused game eight seconds later.
    const a = hash((i) => (i % 2 ? 1 : 0));
    const b = hash((i) => (i === 0 ? 1 : i % 2 ? 1 : 0));
    expect(isDuplicateOf(a, [b])).toBe(true);
  });

  it("lets a genuinely different scene through", () => {
    expect(isDuplicateOf(hash(() => 0), [hash(() => 1)])).toBe(false);
  });
});
