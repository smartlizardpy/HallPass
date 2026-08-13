import { describe, expect, it } from "vitest";
import {
  differenceHash,
  edgeDensity,
  centreCrop,
  DUPLICATE_HASH_DISTANCE,
  fitWithin,
  hammingDistance,
  isBlankFrame,
  isDuplicateOf,
  isEmptyFrame,
  mapRectToFrame,
  MIN_FRAME_DETAIL,
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


describe("fitWithin", () => {
  it("bounds the longest edge and keeps the aspect", () => {
    expect(fitWithin({ width: 2560, height: 1440 }, 1280)).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("bounds the longest edge of a PORTRAIT source, not its width", () => {
    // A phone screenshot. Bounding width alone would leave 1179x2556 untouched
    // and well over the upload cap — the whole reason this is not `fitWidth`.
    expect(fitWithin({ width: 1179, height: 2556 }, 1280)).toEqual({
      width: 590,
      height: 1280,
    });
  });

  it("never upscales", () => {
    expect(fitWithin({ width: 480, height: 320 }, 1280)).toEqual({
      width: 480,
      height: 320,
    });
  });

  it("survives a degenerate size rather than emitting a zero dimension", () => {
    // A zero would make `canvas.width = 0`, and `drawImage` throws on that.
    expect(fitWithin({ width: 0, height: 0 }, 1280)).toEqual({ width: 1, height: 1 });
    expect(fitWithin({ width: 2000, height: 1 }, 1280).height).toBe(1);
    expect(fitWithin({ width: 800, height: 600 }, 0)).toEqual({ width: 1, height: 1 });
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

  it("REJECTS a near-flat gradient", () => {
    // This assertion used to check `luminanceStats(...) < MIN_FRAME_VARIANCE`
    // and never call isBlankFrame at all, so it passed no matter what the
    // function did. It is the case most likely to break when the metric is
    // retuned, which makes it the one worth actually asserting.
    expect(isBlankFrame(rgba(1024, (i) => 120 + Math.floor(i / 128)))).toBe(true);
  });

  it("keeps a frame as dark as the darkest real capture", () => {
    // System.ERROR renders at mean luma 0.03 and was being REJECTED by the old
    // absolute-variance test. Hard black-to-bright pixel transitions at that
    // exposure are exactly what edge density is meant to see.
    expect(isBlankFrame(rgba(1024, (i) => (i % 5 === 0 ? 24 : 0)))).toBe(false);
  });
});

describe("isEmptyFrame", () => {
  /** RGBA where every pixel shares one colour and alpha. */
  function flat(count: number, grey: number, alpha: number): Uint8ClampedArray {
    const buf = new Uint8ClampedArray(count * 4);
    for (let i = 0; i < count; i += 1) {
      buf[i * 4] = grey;
      buf[i * 4 + 1] = grey;
      buf[i * 4 + 2] = grey;
      buf[i * 4 + 3] = alpha;
    }
    return buf;
  }

  it("calls an untouched drawing buffer empty", () => {
    // What a WebGL canvas reads back as without preserveDrawingBuffer.
    expect(isEmptyFrame(flat(4096, 0, 0))).toBe(true);
  });

  it("does NOT call a dark frame empty", () => {
    // The measured regression: these games read back fine and were being
    // discarded by the candidate filter for being dim. Opaque black is a
    // picture — of a black screen, which is frequently the bug being reported.
    expect(isEmptyFrame(flat(4096, 0, 255))).toBe(false);
    expect(isEmptyFrame(flat(4096, 4, 255))).toBe(false);
  });

  it("disagrees with isBlankFrame on exactly that case", () => {
    const darkButPainted = flat(4096, 2, 255);
    expect(isBlankFrame(darkButPainted)).toBe(true); // "not worth keeping"
    expect(isEmptyFrame(darkButPainted)).toBe(false); // "but it IS a readback"
  });

  it("is not fooled by one painted pixel among transparent ones", () => {
    const buf = flat(4096, 0, 0);
    // Alpha of the very last sampled pixel. The stride must still reach it.
    buf[buf.length - 1] = 255;
    expect(isEmptyFrame(buf, 1)).toBe(false);
  });

  it("treats a zero-length buffer as empty rather than throwing", () => {
    expect(isEmptyFrame(new Uint8ClampedArray(0))).toBe(true);
  });
});

describe("edgeDensity", () => {
  it("is zero for a solid fill at any brightness", () => {
    for (const level of [0, 8, 128, 255]) {
      expect(edgeDensity(rgba(1024, () => level))).toBe(0);
    }
  });

  it("does not fall when the SAME picture is darkened", () => {
    // The property the old variance test lacked, and the reason a dark game was
    // losing frames: variance scales with the square of exposure, so halving
    // brightness quartered the score of an unchanged image. Edge density scales
    // linearly, so the same content stays comfortably clear of the threshold.
    const pattern = (scale: number) => rgba(1024, (i) => Math.round(((i * 37) % 256) * scale));
    const bright = edgeDensity(pattern(1));
    const dark = edgeDensity(pattern(0.15));
    expect(dark).toBeGreaterThan(MIN_FRAME_DETAIL);
    // Linear, not quadratic: a 6.7x dimming costs about 6.7x, not 44x.
    expect(bright / dark).toBeLessThan(10);
  });

  it("separates real capture scores from blank ones by a wide margin", () => {
    // Both ends measured from the programme's own captures; see MIN_FRAME_DETAIL.
    const weakestReal = 0.003236;
    const gentleGradient = 0.000108;
    expect(MIN_FRAME_DETAIL).toBeGreaterThan(gentleGradient * 5);
    expect(MIN_FRAME_DETAIL).toBeLessThan(weakestReal / 2);
  });

  it("scores a full-range gradient like real gameplay — a known limit", () => {
    // Documented rather than fixed. No edge-density threshold can split these,
    // and erring the other way is what cost a dark game its screenshots.
    const fullRamp = rgba(1280, (i) => Math.floor((i * 255) / 1280));
    expect(edgeDensity(fullRamp)).toBeGreaterThan(MIN_FRAME_DETAIL);
  });
});

describe("differenceHash", () => {
  /** A 9x8 grayscale buffer from a per-cell function. */
  const grid = (f: (x: number, y: number) => number) =>
    Uint8ClampedArray.from({ length: 72 }, (_, i) => f(i % 9, Math.floor(i / 9)));

  it("is UNCHANGED when the whole frame is darkened", () => {
    // The property average-hash lacked and the reason it failed on dark games:
    // scaling every pixel by the same factor cannot change which of two
    // neighbours is larger, so the hash is invariant by construction rather
    // than by tuning.
    const pattern = (x: number, y: number) => ((x * 31 + y * 17) % 200) + 20;
    const bright = differenceHash(grid(pattern));
    const dark = differenceHash(grid((x, y) => Math.round(pattern(x, y) * 0.1)));
    expect(hammingDistance(bright, dark)).toBe(0);
  });

  it("separates the real dark-game captures the old hash could not", () => {
    // Pinned from the measured distances over System.ERROR's four captures
    // (mean luma 0.03). aHash scored three of the six pairs BELOW the duplicate
    // threshold — at distances of 1, 5 and 6 — for visibly different scenes.
    // dHash scored the same six at 4, 22, 22, 28, 28, 32: one genuine repeat,
    // five clearly distinct.
    //
    // Not reproducible as a synthetic: the failure needs real photographic
    // values clustered within a quantisation step of their own mean, which a
    // hand-written 8-bit grid does not produce. The numbers are the evidence;
    // this asserts the threshold still sits in the gap between them.
    const genuineRepeat = 4;
    const nearestDistinctPair = 22;
    expect(DUPLICATE_HASH_DISTANCE).toBeGreaterThan(genuineRepeat);
    expect(DUPLICATE_HASH_DISTANCE).toBeLessThan(nearestDistinctPair);
  });

  it("calls an identical frame identical", () => {
    const same = grid((x, y) => (x * 13 + y * 7) % 256);
    expect(hammingDistance(differenceHash(same), differenceHash(same))).toBe(0);
  });

  it("returns 64 bits for a short buffer instead of reading past the end", () => {
    const hash = differenceHash(new Uint8ClampedArray(10));
    expect(hash.length).toBe(64);
    expect(Array.from(hash).every((b) => b === 0 || b === 1)).toBe(true);
  });
});

/** A 64-entry hash from a bit-per-cell pattern, for the distance assertions. */
function hash(bits: (i: number) => number): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, i) => (bits(i) ? 1 : 0));
}


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
