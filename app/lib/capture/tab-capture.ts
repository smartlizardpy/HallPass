/**
 * HallPass — tab capture for beta test sessions.
 *
 * Acquires ONE `getDisplayMedia` stream and grabs gameplay frames from it on an
 * interval, cropped to the game iframe. Browser-only: every function here
 * touches `navigator.mediaDevices`, `<canvas>` or `<video>`. The arithmetic
 * lives in `crop.ts` and is tested separately.
 *
 * ── WHY A TAB CAPTURE AND NOT THE IFRAME ────────────────────────────────────
 * The obvious approach — reach into `iframe.contentDocument`, find the canvas,
 * call `toDataURL()` — fails on most of the catalogue:
 *   * EXTERNAL GAMES ARE CROSS-ORIGIN. `contentDocument` is null. There is no
 *     workaround; this is the same-origin policy doing its job.
 *   * WEBGL CANVASES READ BACK BLANK unless the context was created with
 *     `preserveDrawingBuffer: true`, which is the game's choice, not ours.
 *   * DOM-BASED GAMES have no canvas at all.
 * A tab capture is composited by the browser, so it sees exactly what the player
 * sees — every game, every renderer, no cooperation required.
 *
 * ── THE PROMPT IS NOT OPTIONAL ──────────────────────────────────────────────
 * `getDisplayMedia` requires a user gesture and always shows a picker. There is
 * no API that records a tab silently, and there should not be. So capture is
 * armed by an explicit button, once per session.
 *
 * ── "ONLY THE SITE" IS ENFORCED, NOT PROMISED ───────────────────────────────
 * `preferCurrentTab` only PRE-SELECTS this tab; the picker still lets someone
 * choose their whole screen or another window. {@link acquireTabCapture} checks
 * `displaySurface` and stops the track when it is anything but `browser`, so a
 * mis-click cannot start recording the rest of someone's desktop.
 *
 * ── THE TESTER HUD NEVER APPEARS IN A SHOT ──────────────────────────────────
 * The captured frame is the whole viewport, HUD included. Every grab is cropped
 * to the iframe's own rectangle before it is kept, so the recording indicator
 * and report buttons are outside the image by construction rather than by
 * remembering to hide them. See `mapRectToFrame`.
 */

import {
  averageHash,
  centreCrop,
  isBlankFrame,
  isDuplicateOf,
  mapRectToFrame,
  type FrameHash,
  type Rect,
} from "./crop";

/** Why a capture attempt did not produce a usable stream. */
export type CaptureFailure =
  | "unsupported"
  | "denied"
  | "wrong-surface"
  | "no-track";

export type CaptureResult =
  | { ok: true; stream: MediaStream; track: MediaStreamTrack }
  | { ok: false; reason: CaptureFailure };

/** True when this browser can capture a tab at all. */
export function canCapture(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
    typeof window !== "undefined" &&
    typeof window.MediaStreamTrack !== "undefined"
  );
}

/**
 * Prompt for tab capture and validate what came back.
 *
 * MUST be called from a user gesture. `audio: false` is deliberate and not a
 * default worth changing: nothing here needs sound, and capturing a child's
 * microphone or system audio to illustrate a rendering bug would be a wildly
 * disproportionate thing to do.
 */
export async function acquireTabCapture(): Promise<CaptureResult> {
  if (!canCapture()) return { ok: false, reason: "unsupported" };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 } },
      audio: false,
      // Chrome-only hint; other browsers ignore it and show a full picker,
      // which the displaySurface check below then filters.
      preferCurrentTab: true,
    } as DisplayMediaStreamOptions);
  } catch {
    // Cancelling the picker rejects, which is not an error worth logging — it
    // is the most common outcome and the UI simply stays disarmed.
    return { ok: false, reason: "denied" };
  }

  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    return { ok: false, reason: "no-track" };
  }

  // `displaySurface` is "browser" for a tab, "window" / "monitor" otherwise.
  // Anything else gets stopped immediately rather than merely warned about.
  const surface = track.getSettings().displaySurface;
  if (surface && surface !== "browser") {
    stream.getTracks().forEach((t) => t.stop());
    return { ok: false, reason: "wrong-surface" };
  }

  return { ok: true, stream, track };
}

/** A captured gameplay still, ready to preview and submit. */
export type Shot = {
  /** Stable within a session; used as the React key and the upload filename. */
  id: string;
  blob: Blob;
  /** Object URL for the preview. The owner must revoke it. */
  previewUrl: string;
  width: number;
  height: number;
};

/**
 * Pulls frames off a capture stream on an interval and keeps the good ones.
 *
 * Drives a hidden `<video>` bound to the stream, draws crops of it into an
 * offscreen canvas, and filters each grab through the blank-frame and duplicate
 * checks in `crop.ts`. Candidates are capped so a long session cannot grow an
 * unbounded array of decoded bitmaps.
 */
export class FrameGrabber {
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly hashCanvas: HTMLCanvasElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly hashes: FrameHash[] = [];
  private busy = false;

  constructor(
    private readonly stream: MediaStream,
    private readonly options: {
      /** Returns the game iframe's CSS rect, or null if it is not mounted. */
      getTargetRect: () => Rect | null;
      /** Called with each accepted still. */
      onShot: (shot: Shot) => void;
      /** Stop grabbing once this many have been kept. */
      maxShots: number;
      intervalMs?: number;
      /** Crop to this aspect after cropping to the iframe. */
      aspect?: number;
      /** Longest edge of the stored image. */
      maxEdge?: number;
    },
  ) {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
    this.canvas = document.createElement("canvas");
    this.hashCanvas = document.createElement("canvas");
    this.hashCanvas.width = 8;
    this.hashCanvas.height = 8;
  }

  async start(): Promise<void> {
    try {
      await this.video.play();
    } catch {
      // Autoplay of a muted MediaStream is allowed everywhere we support, but a
      // failure here just means no frames — never a thrown session.
      return;
    }
    const every = this.options.intervalMs ?? 8000;
    // One immediate grab so the filmstrip is not empty for the first interval,
    // then on a timer.
    void this.grab();
    this.timer = setInterval(() => void this.grab(), every);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.video.pause();
    this.video.srcObject = null;
  }

  private async grab(): Promise<void> {
    // Skip rather than queue: a slow toBlob must not let two grabs interleave
    // on the same canvas.
    if (this.busy) return;
    if (this.hashes.length >= this.options.maxShots) return;
    const frameW = this.video.videoWidth;
    const frameH = this.video.videoHeight;
    if (frameW === 0 || frameH === 0) return;

    const cssRect = this.options.getTargetRect();
    if (!cssRect || cssRect.width < 2 || cssRect.height < 2) return;

    this.busy = true;
    try {
      // 1. Crop the captured frame to the iframe — this is what excludes the
      //    tester HUD from every stored image.
      const source = mapRectToFrame(
        cssRect,
        { width: window.innerWidth, height: window.innerHeight },
        { width: frameW, height: frameH },
      );

      // 2. Centre-crop that to the target aspect, then scale to the max edge.
      const aspect = this.options.aspect ?? source.width / source.height;
      const inner = centreCrop(source, aspect);
      const cropX = source.x + inner.x;
      const cropY = source.y + inner.y;

      const maxEdge = this.options.maxEdge ?? 1280;
      const scale = Math.min(1, maxEdge / Math.max(inner.width, inner.height));
      const outW = Math.max(1, Math.round(inner.width * scale));
      const outH = Math.max(1, Math.round(inner.height * scale));

      this.canvas.width = outW;
      this.canvas.height = outH;
      const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(
        this.video,
        cropX,
        cropY,
        inner.width,
        inner.height,
        0,
        0,
        outW,
        outH,
      );

      // 3. Reject loading screens and fades.
      const pixels = ctx.getImageData(0, 0, outW, outH).data;
      if (isBlankFrame(pixels)) return;

      // 4. Reject a repeat of something already kept. The 8x8 downscale is done
      //    by the browser because it does it in hardware.
      const hashCtx = this.hashCanvas.getContext("2d", { willReadFrequently: true });
      if (!hashCtx) return;
      hashCtx.drawImage(this.canvas, 0, 0, 8, 8);
      const grey = hashCtx.getImageData(0, 0, 8, 8).data;
      const mono = new Uint8ClampedArray(64);
      for (let i = 0; i < 64; i += 1) {
        mono[i] =
          (0.299 * grey[i * 4] + 0.587 * grey[i * 4 + 1] + 0.114 * grey[i * 4 + 2]) | 0;
      }
      const hash = averageHash(mono);
      if (isDuplicateOf(hash, this.hashes)) return;

      const blob = await new Promise<Blob | null>((resolve) =>
        this.canvas.toBlob((b) => resolve(b), "image/webp", 0.9),
      );
      if (!blob) return;

      this.hashes.push(hash);
      this.options.onShot({
        id: `${Date.now().toString(36)}-${this.hashes.length}`,
        blob,
        previewUrl: URL.createObjectURL(blob),
        width: outW,
        height: outH,
      });
    } finally {
      this.busy = false;
    }
  }
}
