/**
 * HallPass — grabbing a gameplay frame with no permission and no stream.
 *
 * `tab-capture.ts` is the good path: it sees whatever the player sees, for every
 * game, because the browser composites it. It also requires `getDisplayMedia`,
 * which WebKit does not implement on iOS — and every browser on iOS is WebKit,
 * so an iPhone has no way to reach it at all. This module is what those devices
 * get instead.
 *
 * ── HOW IT WORKS ────────────────────────────────────────────────────────────
 * Bundled games are served from `/game-html/<slug>/` on OUR OWN ORIGIN, which is
 * already how `attachToFrame` in `error-log.ts` reaches inside the frame to
 * collect a game's stack traces. The same-origin access that allows that also
 * allows reading the game's `<canvas>` and drawing it into one of ours.
 *
 * ── WHAT IT CANNOT DO, WHICH IS THE IMPORTANT PART ──────────────────────────
 * This is a fallback with real holes in it, and each one is DETECTED rather than
 * hoped about — a capture button that silently produces nothing is worse than no
 * button, because the tester spends their evidence-gathering effort on it:
 *
 *   * EXTERNAL GAMES ARE CROSS-ORIGIN. `contentDocument` is null and there is no
 *     workaround; this is the same-origin policy doing its job. → `cross-origin`
 *   * WEBGL READS BACK BLANK unless the game created its context with
 *     `preserveDrawingBuffer: true`, which is the game's choice and not ours. We
 *     cannot inject a shim to force it either: most games 307 to the static
 *     mirror under `/games/`, so the HTML we serve is never rewritten on the way
 *     past. Caught by the same {@link isBlankFrame} that rejects loading
 *     screens. → `blank`
 *   * A CANVAS TAINTED by a cross-origin texture throws `SecurityError` on
 *     readback, even though the canvas itself is same-origin. → `tainted`
 *   * DOM-ONLY GAMES have no canvas to read. → `no-canvas`
 *
 * ── WHY THE OUTPUT IS NOT 16:9 ──────────────────────────────────────────────
 * `FrameGrabber` pins every still to 16:9 at 1280 wide so it always satisfies
 * the gallery's upload policy. That is right for a crop out of a full-viewport
 * capture, where the surroundings are HUD anyway. Here the source IS the game,
 * so centre-cropping to 16:9 would throw away the top and bottom of a portrait
 * or 4:3 game — deleting the part of the picture the bug is probably in. The
 * grab keeps the game's own shape, and `isGalleryShape()` decides separately
 * whether it can double as a gallery candidate.
 */

import { fitWithin, isBlankFrame } from "./crop";
import type { Shot } from "./tab-capture";

/** Why a grab produced nothing. Every one of these is reported, never swallowed. */
export type GrabFailure =
  | "cross-origin"
  | "no-canvas"
  | "blank"
  | "tainted"
  | "failed";

export type GrabResult =
  | { ok: true; shot: Shot }
  | { ok: false; reason: GrabFailure };

/** Longest edge of a grabbed still. Matches `DEFAULT_CAPTURE_WIDTH`. */
const DEFAULT_MAX_EDGE = 1280;

/**
 * Smallest backing store worth treating as the game.
 *
 * Games routinely keep small offscreen canvases for tile atlases, lighting masks
 * and text measurement. 64x64 is below anything a game actually renders itself
 * into and above the scratch buffers, so it removes the noise without needing to
 * understand what any particular game is doing.
 */
export const MIN_CANVAS_AREA = 64 * 64;

/** What {@link pickGameCanvas} needs to know about a candidate. */
export type CanvasCandidate = {
  /** Backing store size — the pixels that would actually be read. */
  width: number;
  height: number;
  /** Laid-out size. Zero for a canvas that is display:none or detached. */
  renderedWidth: number;
  renderedHeight: number;
};

/**
 * Choose the canvas that is most likely to BE the game.
 *
 * Visible first, then largest backing store. Visibility is the stronger signal:
 * an offscreen buffer can easily be larger than the canvas being presented, and
 * grabbing it yields a picture the player never saw — which for a bug report is
 * actively misleading rather than merely wrong.
 *
 * Ties keep the first, which is document order, which is the one a game with two
 * equally-sized layers stacked on top of each other declared first.
 */
export function pickGameCanvas<T extends CanvasCandidate>(
  candidates: readonly T[],
): T | null {
  let best: T | null = null;
  let bestArea = 0;
  for (const candidate of candidates) {
    if (candidate.renderedWidth <= 0 || candidate.renderedHeight <= 0) continue;
    const area = candidate.width * candidate.height;
    if (area < MIN_CANVAS_AREA) continue;
    if (area > bestArea) {
      best = candidate;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Reach into a game frame, or say why not.
 *
 * Follows `attachToFrame`'s proven shape: reading `contentWindow` does not trip
 * the security check, TOUCHING a property on it does, so the probe has to do the
 * latter inside the `try`.
 */
function reachInto(
  frame: HTMLIFrameElement,
): { ok: true; doc: Document } | { ok: false; reason: GrabFailure } {
  try {
    const win = frame.contentWindow;
    void win?.location.href;
    const doc = frame.contentDocument;
    if (!doc) return { ok: false, reason: "cross-origin" };
    return { ok: true, doc };
  } catch {
    return { ok: false, reason: "cross-origin" };
  }
}

/**
 * Grab one still out of a same-origin game frame.
 *
 * Needs no user gesture, no permission prompt and no `getDisplayMedia`, so it is
 * safe to call automatically — which is what makes it useful at the moment a bug
 * report is opened rather than only behind a button.
 */
export async function grabGameFrame(
  frame: HTMLIFrameElement | null,
  options: { maxEdge?: number } = {},
): Promise<GrabResult> {
  if (!frame) return { ok: false, reason: "failed" };

  const reached = reachInto(frame);
  if (!reached.ok) return reached;

  const canvases = Array.from(reached.doc.querySelectorAll("canvas"));
  const measured = canvases.map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      element,
      width: element.width,
      height: element.height,
      renderedWidth: rect.width,
      renderedHeight: rect.height,
    };
  });

  const picked = pickGameCanvas(measured);
  if (!picked) return { ok: false, reason: "no-canvas" };

  const out = fitWithin(picked, options.maxEdge ?? DEFAULT_MAX_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ok: false, reason: "failed" };

  let pixels: Uint8ClampedArray;
  try {
    // Both of these can throw `SecurityError` when the game's own canvas was
    // tainted by a cross-origin texture — the draw propagates the taint, and the
    // read is where it surfaces. Same try, because either one means the same
    // thing to the tester.
    ctx.drawImage(picked.element, 0, 0, out.width, out.height);
    pixels = ctx.getImageData(0, 0, out.width, out.height).data;
  } catch {
    return { ok: false, reason: "tainted" };
  }

  // A WebGL canvas without `preserveDrawingBuffer` reads back as a cleared
  // buffer, which is exactly what this check was written to recognise.
  if (isBlankFrame(pixels)) return { ok: false, reason: "blank" };

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/webp", 0.9),
  );
  if (!blob) return { ok: false, reason: "failed" };

  return {
    ok: true,
    shot: {
      id: `dom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      blob,
      previewUrl: URL.createObjectURL(blob),
      width: out.width,
      height: out.height,
      // Read straight out of the game's own canvas, so it is the game and
      // nothing else — gallery-eligible if its shape allows.
      origin: "grab",
    },
  };
}
