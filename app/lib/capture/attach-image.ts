/**
 * HallPass — preparing an image a tester picked themselves.
 *
 * The other two capture paths produce their own bytes and know exactly what they
 * made. This one takes whatever came out of a photo library, so it has to make it
 * safe to send before it goes anywhere.
 *
 * ── WHY IT IS ALWAYS RE-ENCODED, EVEN WHEN IT LOOKS FINE ────────────────────
 * A phone screenshot is 3–8 MB of PNG and the upload cap is 4 MB, so sending the
 * original fails on precisely the devices this exists for. Re-encoding also
 * solves a problem nobody would think to look for: an iPhone photo is HEIC,
 * which `sniffImageType` does not accept and never should — but the browser can
 * DECODE it, so drawing it to a canvas and encoding the result hands the server
 * an ordinary WebP. The format question disappears instead of being negotiated.
 *
 * ── WHY `<img>` AND NOT `createImageBitmap` ─────────────────────────────────
 * `createImageBitmap` is the tidier API and arrived in Safari 15. School phones
 * and hand-me-down iPads are exactly the population that has not got there, and
 * an `<img>` with `decode()` works everywhere and costs one more line.
 *
 * ── WHY THE CANVAS IS NOT TAINTED ───────────────────────────────────────────
 * The source is an object URL, which is same-origin, so the result reads back
 * cleanly. Nothing here can be used to launder a cross-origin image: a `File`
 * only ever comes from the user's own device.
 */

import { fitWithin } from "./crop";
import type { Shot } from "./tab-capture";
import { MAX_MEDIA_BYTES, MIN_EVIDENCE_EDGE } from "../image-meta";

/** Why a picked file could not be turned into an attachment. */
export type AttachFailure = "unreadable" | "too-small" | "too-heavy";

export type AttachResult =
  | { ok: true; shot: Shot }
  | { ok: false; reason: AttachFailure };

/**
 * Longest edge of a prepared attachment.
 *
 * Generous next to the 1280 the grabbers use, because this picture is often a
 * whole phone screen rather than a game frame — the bug may be six point text in
 * one corner of it, and a screenshot too soft to read is not evidence.
 */
const ATTACH_MAX_EDGE = 1600;

/** Quality ladder, tried in order until one lands under the cap. */
const ATTEMPTS: readonly { maxEdge: number; quality: number }[] = [
  { maxEdge: ATTACH_MAX_EDGE, quality: 0.85 },
  { maxEdge: 1200, quality: 0.7 },
  { maxEdge: 900, quality: 0.6 },
];

/**
 * Encode a canvas, preferring WebP.
 *
 * Safari only learned to ENCODE WebP in 14, and the spec's answer to an
 * unsupported type is to silently produce a PNG — which for a screenshot is
 * larger than the original and would defeat the whole point of re-encoding. So
 * the result is checked rather than trusted, and JPEG is the fallback because
 * every browser that can draw a canvas can encode one.
 */
async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  const toBlob = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), type, quality));

  const webp = await toBlob("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  return toBlob("image/jpeg");
}

/** Decode a file into an element we can draw, or null if it is not an image. */
async function decode(file: File): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
    return img;
  } catch {
    // Not an image, a truncated download, or a format this browser cannot read.
    // All three are the same thing to the tester.
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Turn a file the tester picked into an attachment the server will accept.
 *
 * Returns a {@link Shot}, the same shape the two automatic grabbers produce, so
 * everything downstream — the preview, the attach control, the submit path —
 * handles one type and cannot grow a second code path for hand-picked images.
 *
 * The caller owns `shot.previewUrl` and must revoke it.
 */
export async function prepareAttachment(file: File): Promise<AttachResult> {
  const img = await decode(file);
  if (!img) return { ok: false, reason: "unreadable" };

  const source = { width: img.naturalWidth, height: img.naturalHeight };
  if (Math.max(source.width, source.height) < MIN_EVIDENCE_EDGE) {
    // Mirrors `validateEvidenceUpload` so the refusal happens here, in front of
    // the person who can choose a different picture, rather than after an upload.
    return { ok: false, reason: "too-small" };
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, reason: "unreadable" };

  for (const attempt of ATTEMPTS) {
    const out = fitWithin(source, attempt.maxEdge);
    canvas.width = out.width;
    canvas.height = out.height;
    ctx.clearRect(0, 0, out.width, out.height);
    ctx.drawImage(img, 0, 0, out.width, out.height);

    const blob = await encode(canvas, attempt.quality);
    if (!blob) continue;
    if (blob.size > MAX_MEDIA_BYTES) continue;

    return {
      ok: true,
      shot: {
        id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        blob,
        previewUrl: URL.createObjectURL(blob),
        width: out.width,
        height: out.height,
        origin: "attach",
      },
    };
  }

  // Every rung of the ladder came back over the cap. Vanishingly unlikely for a
  // screenshot, but a 48-megapixel photo of a screen is a real thing a tester
  // might send, and "it silently did nothing" is not an acceptable answer to it.
  return { ok: false, reason: "too-heavy" };
}
