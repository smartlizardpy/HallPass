/**
 * HallPass — pure geometry and frame-quality maths for gameplay capture.
 *
 * No DOM, no browser APIs, no React: everything here is arithmetic over plain
 * numbers and pixel arrays, so it is unit-testable without a headless browser.
 * The modules that DO touch `getDisplayMedia`, `<canvas>` and `MediaRecorder`
 * import from here and stay as thin as possible.
 *
 * WHY THE CROP EXISTS AT ALL. A tab capture is the whole viewport — which during
 * a test session includes the recording indicator, the report buttons and the
 * rest of the tester HUD. Those must never reach a screenshot that ends up in a
 * game's public gallery: the picture is supposed to show the GAME. Cropping to
 * the iframe's own rectangle is what guarantees that, and it is a geometric
 * guarantee rather than a "remember to hide the toolbar first" convention.
 */

/** A rectangle in the captured frame's own pixel space. */
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Map a CSS-pixel rectangle (from `getBoundingClientRect()`) into the captured
 * frame's pixel space.
 *
 * The stream's dimensions are NOT the viewport's: the browser picks a capture
 * resolution, and on a HiDPI display or a resized window it differs from
 * `window.innerWidth` by an arbitrary factor. Deriving the scale from the two
 * widths handles every case without ever reading `devicePixelRatio`, which lies
 * on a zoomed page.
 *
 * The result is clamped to the frame so a partially-scrolled or oversized iframe
 * can never produce negative offsets or a crop that runs past the buffer — both
 * of which make `drawImage` throw or silently emit transparent pixels.
 */
export function mapRectToFrame(
  cssRect: Rect,
  viewport: { width: number; height: number },
  frame: { width: number; height: number },
): Rect {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return { x: 0, y: 0, width: frame.width, height: frame.height };
  }
  const scaleX = frame.width / viewport.width;
  const scaleY = frame.height / viewport.height;

  const x = Math.max(0, Math.round(cssRect.x * scaleX));
  const y = Math.max(0, Math.round(cssRect.y * scaleY));
  const width = Math.max(1, Math.round(cssRect.width * scaleX));
  const height = Math.max(1, Math.round(cssRect.height * scaleY));

  return {
    x: Math.min(x, Math.max(0, frame.width - 1)),
    y: Math.min(y, Math.max(0, frame.height - 1)),
    width: Math.min(width, frame.width - Math.min(x, frame.width - 1)),
    height: Math.min(height, frame.height - Math.min(y, frame.height - 1)),
  };
}

/**
 * The largest centred sub-rectangle of `source` with the given aspect ratio.
 *
 * Used to turn a 16:9 gameplay frame into the near-square 659×613 cover shape
 * without squashing it. Centre-crop rather than letterbox: bars would be baked
 * into the stored image, and every surface that renders a cover assumes the
 * whole rectangle is picture.
 */
export function centreCrop(
  source: { width: number; height: number },
  aspect: number,
): Rect {
  if (aspect <= 0 || source.width <= 0 || source.height <= 0) {
    return { x: 0, y: 0, width: Math.max(1, source.width), height: Math.max(1, source.height) };
  }
  const sourceAspect = source.width / source.height;

  // The offset FLOORS rather than rounds. With an odd leftover, perfect integer
  // centring is impossible, and rounding up would put `x + width` one pixel past
  // the source edge — which `drawImage` answers with a transparent column rather
  // than an error, so it would ship as a hairline artefact down one side of a
  // cover. Flooring biases the crop half a pixel left/up instead, which nobody
  // can see and no renderer can trip over.
  if (sourceAspect > aspect) {
    // Too wide — trim the sides.
    const width = Math.min(source.width, Math.max(1, Math.round(source.height * aspect)));
    return {
      x: Math.floor((source.width - width) / 2),
      y: 0,
      width,
      height: source.height,
    };
  }
  // Too tall — trim top and bottom.
  const height = Math.min(source.height, Math.max(1, Math.round(source.width / aspect)));
  return {
    x: 0,
    y: Math.floor((source.height - height) / 2),
    width: source.width,
    height,
  };
}

/**
 * Mean and variance of an RGBA buffer's luminance, both normalised to 0–1.
 *
 * `variance` is the interesting one: a loading screen, a fade-to-black and a
 * flat colour-filled menu all have near-zero variance, and those are exactly the
 * frames an interval grabber keeps catching. Rejecting on variance is far more
 * robust than rejecting on brightness, which would throw away a legitimately
 * dark game and keep a plain white screen.
 *
 * Samples every `step`-th pixel (default 4) — at 1280×720 that is ~57k samples,
 * plenty for a variance estimate and four times cheaper than reading all of it.
 */
export function luminanceStats(
  rgba: Uint8ClampedArray,
  step = 4,
): { mean: number; variance: number } {
  const stride = Math.max(1, Math.floor(step)) * 4;
  let sum = 0;
  let sumSquares = 0;
  let n = 0;

  for (let i = 0; i + 2 < rgba.length; i += stride) {
    // Rec. 601 luma — cheap, and the perceptual weighting matters here because
    // green dominates most games' mid-tones.
    const y = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255;
    sum += y;
    sumSquares += y * y;
    n += 1;
  }
  if (n === 0) return { mean: 0, variance: 0 };

  const mean = sum / n;
  return { mean, variance: Math.max(0, sumSquares / n - mean * mean) };
}

/**
 * Below this luminance variance a frame is treated as blank.
 *
 * Tuned against real loading screens: a solid fill sits at ~0, a gradient
 * splash around 0.002, and any frame with actual sprites in it clears 0.01
 * comfortably.
 */
export const MIN_FRAME_VARIANCE = 0.006;

/** True when a frame is too flat to be worth keeping as a candidate. */
export function isBlankFrame(rgba: Uint8ClampedArray): boolean {
  return luminanceStats(rgba).variance < MIN_FRAME_VARIANCE;
}

/**
 * A perceptual average hash: 64 one-bit values, one per cell of an already
 * downscaled 8×8 grayscale buffer.
 *
 * WHY A BYTE ARRAY AND NOT A 64-BIT INTEGER. The natural representation is a
 * single 64-bit number, but this repo targets ES2017 and `BigInt` literals need
 * ES2020 — and raising the whole project's target to tidy one hash function
 * would change the emitted output and browser floor for every file in the
 * codebase. Two 32-bit halves would work but make the popcount fiddly for no
 * gain: at most six hashes are ever held at once, so 64 bytes each is free.
 *
 * The caller does the 8×8 downscale on a canvas, because that is the browser's
 * job and it does it in hardware.
 */
export type FrameHash = Uint8Array;

export function averageHash(gray8x8: Uint8ClampedArray): FrameHash {
  const n = Math.min(64, gray8x8.length);
  let total = 0;
  for (let i = 0; i < n; i += 1) total += gray8x8[i];
  const mean = total / (n || 1);

  const hash = new Uint8Array(64);
  for (let i = 0; i < n; i += 1) {
    hash[i] = gray8x8[i] > mean ? 1 : 0;
  }
  return hash;
}

/** Number of differing bits between two average hashes. */
export function hammingDistance(a: FrameHash, b: FrameHash): number {
  let count = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) count += 1;
  }
  return count;
}

/**
 * Fewer than this many differing bits means "the same picture again".
 *
 * A paused game, a menu left open, or two grabs a few seconds apart in a slow
 * scene all produce near-identical hashes. 10/64 is loose enough to catch those
 * and tight enough that genuinely different scenes survive.
 */
export const DUPLICATE_HASH_DISTANCE = 10;

/** True when `hash` is within the duplicate threshold of anything already kept. */
export function isDuplicateOf(
  hash: FrameHash,
  seen: readonly FrameHash[],
): boolean {
  return seen.some((other) => hammingDistance(hash, other) < DUPLICATE_HASH_DISTANCE);
}
