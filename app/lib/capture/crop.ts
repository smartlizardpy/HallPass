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
 * Scale a size down until its longest edge fits `maxEdge`, keeping the aspect.
 *
 * WHY THE LONGEST EDGE AND NOT THE WIDTH. Everything the tab capture produces is
 * landscape, so bounding the width was the same question. Evidence from a phone
 * is not: a 1179x2556 screenshot bounded by width alone comes back unchanged and
 * sails past the upload cap in the one place — a phone, on a school network —
 * where a failed 8 MB upload costs the most.
 *
 * NEVER UPSCALES. A game rendering at 480x320 is stored at 480x320. Nothing
 * downstream requires a minimum size for evidence (see `validateEvidenceUpload`),
 * so inventing pixels would only cost bytes; the opposite trade is right for
 * `FrameGrabber`, which upscales deliberately because the gallery DOES have a
 * floor and a soft screenshot beats a rejected one.
 */
export function fitWithin(
  source: { width: number; height: number },
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(source.width, source.height);
  if (longest <= 0 || maxEdge <= 0) return { width: 1, height: 1 };
  const scale = Math.min(1, maxEdge / longest);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/**
 * Minimum edge density for a frame to count as having something in it.
 *
 * ── WHY VARIANCE WAS THE WRONG MEASUREMENT ──────────────────────────────────
 * Variance of raw luma measures how dark a frame is at least as much as how
 * empty it is: squash every value toward zero and variance falls with the SQUARE
 * of the scale, whatever the picture contains. So a dark game lost frames for
 * being dark, and the darker the game the more it lost. Measured against the
 * captures the programme has actually collected:
 *
 *   raw variance   x0.006   what it was
 *   0.0059         0.98x    System.ERROR gameplay — REJECTED as blank
 *   0.0068         1.13x    Duskfall gameplay — kept, barely
 *   0.0386         6.4x     Duskfall gameplay
 *
 * Three of eleven survivors sat within 20% of being discarded, and the ones that
 * were discarded never reached the server to be counted. Edge density asks the
 * question that was actually meant — "does anything CHANGE across this frame" —
 * and a loading screen fails it however bright it is.
 *
 * ── WHY NOT NORMALISE BY DYNAMIC RANGE ──────────────────────────────────────
 * Dividing edge density by the frame's own 5th–95th percentile span looks more
 * principled and measures worse: Duskfall's bright sun against dark ground gives
 * it a large span, which divided its score down to within 6x of a gradient,
 * while the uniformly-dark System.ERROR scored 40x higher. Raw edge density
 * separates the same set by 6.6x in the right direction.
 *
 * ── THE NUMBER ──────────────────────────────────────────────────────────────
 * All measured at the default sampling step, which matters — striding inflates
 * a gradient's apparent edges, so figures taken at step 1 do not transfer.
 *
 *   0.000000  solid black, solid white
 *   0.000108  a gentle splash gradient
 *   ---------- 0.0015, here ----------
 *   0.003236  the weakest real capture on record
 *   0.012729  the busiest
 *   0.037647  a very dark frame with hard pixel edges
 *
 * 14x clear of the worst thing that must be rejected, 2x clear of the weakest
 * thing that must be kept.
 *
 * ── WHAT IT DOES NOT CATCH ──────────────────────────────────────────────────
 * A smooth gradient sweeping the FULL black-to-white range across the frame
 * scores 0.0031 — indistinguishable from the weakest real gameplay frame, and
 * no threshold can separate them. That is accepted rather than solved: nothing
 * in this catalogue loads on a full-range gradient, and the cost of keeping one
 * is a candidate the tester does not pick. The cost of the opposite mistake was
 * an entire dark game losing its screenshots.
 */
export const MIN_FRAME_DETAIL = 0.0015;

/**
 * Mean absolute luma difference between consecutive sampled pixels.
 *
 * Consecutive in the BUFFER, which is horizontally adjacent everywhere except
 * once per row — at 1280 wide that is one sample in 320, far below the noise
 * this is measuring. Not worth threading a width through for.
 *
 * Brightness-robust where it matters: a frame with edges has edges wherever its
 * exposure sits, and a frame with none has none however bright it is.
 */
export function edgeDensity(rgba: Uint8ClampedArray, step = 4): number {
  const stride = Math.max(1, Math.floor(step)) * 4;
  let previous: number | null = null;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 2 < rgba.length; i += stride) {
    const y = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255;
    if (previous !== null) {
      sum += Math.abs(y - previous);
      n += 1;
    }
    previous = y;
  }
  return n === 0 ? 0 : sum / n;
}

/** True when a frame is too flat to be worth keeping as a candidate. */
export function isBlankFrame(rgba: Uint8ClampedArray): boolean {
  return edgeDensity(rgba) < MIN_FRAME_DETAIL;
}

/**
 * True when NOTHING was drawn — every sampled pixel fully transparent.
 *
 * ── WHY THIS IS NOT {@link isBlankFrame} ────────────────────────────────────
 * They answer different questions and the difference was measured, not guessed.
 * `isBlankFrame` asks "is this frame worth KEEPING", which is the right question
 * for the automatic grabber: it fires unattended every 8 seconds and its output
 * is a set of candidates for a game's page, so a loading screen is noise.
 *
 * An explicit grab is the opposite situation. A tester pressed a button, about a
 * frame they are looking at, to attach to a bug report — and a plain frame is
 * frequently the very thing being reported. Running the candidate filter over it
 * threw away real pictures of real games. Measured across the catalogue at rest:
 *
 *   game            opaque   mean luma   edge density
 *   chroma-orbit      100%      0.0092     0          } read back FINE,
 *   neon-snake        100%      0.0164     0.000698   } rejected as "blank"
 *   symbiosis         100%      0.0187     0.001009   } by the 0.0015 floor
 *   pixel-slicer      100%      0.0925     0.001397   }
 *   ---------------------------------------------------
 *   system-error        0%      0          0         <- genuinely nothing there
 *   silence             0%      0          0         <- genuinely nothing there
 *
 * Four of six were dark or low-contrast rather than empty, and `pixel-slicer`
 * missed the threshold by 0.0001. The two real failures are distinguished by
 * ALPHA, not by detail: a WebGL drawing buffer that was not preserved reads back
 * fully TRANSPARENT, so `alpha > 0` anywhere is proof that something painted.
 *
 * That makes this a fact about the readback rather than a judgement about the
 * picture — which is what the caller actually needs to know before it tells a
 * tester their game cannot be read.
 */
export function isEmptyFrame(rgba: Uint8ClampedArray, step = 4): boolean {
  const stride = Math.max(1, Math.floor(step)) * 4;
  for (let i = 0; i + 3 < rgba.length; i += stride) {
    if (rgba[i + 3] !== 0) return false;
  }
  return true;
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


/**
 * A difference hash: 64 bits, each "is this cell brighter than the one to its
 * right", over a 9-wide by 8-tall grayscale buffer.
 *
 * ── WHY THIS REPLACED {@link averageHash} FOR DUPLICATE DETECTION ────────────
 * An average hash thresholds every cell against the frame's MEAN. On a dark
 * game the whole 8x8 grid sits within a few quantisation steps of that mean, so
 * which side of it a cell falls on is decided by rounding noise — the hash stops
 * describing the picture and starts describing the dither. Measured on the
 * programme's real captures from System.ERROR (mean luma 0.03):
 *
 *              aHash                  dHash
 *   distances  1, 5, 6, 17, 22, 23    4, 22, 22, 28, 28, 32
 *
 * Three of six pairs looked like the same picture to aHash, at distances as low
 * as 1, and they were visibly different scenes. dHash separates the same set
 * cleanly: one genuinely near-identical pair at 4, everything else past 22.
 *
 * It is invariant to brightness by CONSTRUCTION, not by tuning — scaling every
 * pixel by the same factor cannot change which of two neighbours is larger.
 * That is the property an average hash lacks and no threshold can restore.
 */
export function differenceHash(gray9x8: Uint8ClampedArray): FrameHash {
  const hash = new Uint8Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = gray9x8[y * 9 + x] ?? 0;
      const right = gray9x8[y * 9 + x + 1] ?? 0;
      hash[y * 8 + x] = left > right ? 1 : 0;
    }
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
 *
 * KEPT AT 10 ON PURPOSE when the hash changed to {@link differenceHash}. Across
 * the programme's real captures the separation is wide enough that the exact
 * number barely matters: the one genuinely repeated pair scores 4, and the next
 * closest pair of distinct scenes scores 20. Anything from about 8 to 15 gives
 * the same answers, so the previous value was left alone rather than retuned to
 * a suspiciously precise figure the data does not actually justify.
 */
export const DUPLICATE_HASH_DISTANCE = 10;

/** True when `hash` is within the duplicate threshold of anything already kept. */
export function isDuplicateOf(
  hash: FrameHash,
  seen: readonly FrameHash[],
): boolean {
  return seen.some((other) => hammingDistance(hash, other) < DUPLICATE_HASH_DISTANCE);
}
