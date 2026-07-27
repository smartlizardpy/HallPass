/**
 * HallPass — image sniffing and dimension reading, from bytes alone.
 *
 * Used by the dashboard Media panel to validate uploaded screenshots before they
 * reach Vercel Blob. Pure and dependency-free: no `server-only` import, so it
 * unit-tests in the plain `node` environment like `scoreboard/guard.ts` and
 * `board-input.ts`.
 *
 * WHY NOT `sharp` (or any image library). The repo has zero image dependencies —
 * it does not even use `next/image`. Adding an image toolchain to read two
 * integers out of a header would pull a large native binary into the serverless
 * bundle for every route that transitively imports it. Reading PNG/JPEG/WebP
 * dimensions is ~60 lines of byte arithmetic, so it is written out.
 *
 * WHY MAGIC BYTES, NOT `file.type`. `File.type` is attacker-controlled — it comes
 * from the browser's guess at the filename extension and can be set to anything
 * by a hand-built multipart request. Sniffing the actual signature is what makes
 * the `content_type` CHECK constraint on `game_media` mean something, and it is
 * what stops an SVG (a scriptable document, and an XSS vector when served from
 * our own origin) being stored as `image/png`.
 *
 * Every function returns `null` rather than throwing on malformed input: these
 * run against untrusted uploads and a truncated file is an expected case, not an
 * exceptional one.
 */

/** The image formats accepted for game media. SVG is deliberately excluded. */
export type ImageType = "image/png" | "image/jpeg" | "image/webp";

export type ImageMeta = {
  type: ImageType;
  width: number;
  height: number;
};

/** Byte-for-byte prefix match at `offset`. */
function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff];
const RIFF_SIG = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_SIG = [0x57, 0x45, 0x42, 0x50]; // "WEBP" at offset 8

/**
 * Identify an image by its signature bytes, or `null` if it is not one of the
 * three accepted formats. WebP needs both halves of the check: `RIFF` alone also
 * matches WAV and AVI containers.
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, PNG_SIG)) return "image/png";
  if (startsWith(bytes, JPEG_SIG)) return "image/jpeg";
  if (startsWith(bytes, RIFF_SIG) && startsWith(bytes, WEBP_SIG, 8)) {
    return "image/webp";
  }
  return null;
}

/** Big-endian uint32 at `offset`. */
function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

/** Big-endian uint16 at `offset`. */
function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

/** Little-endian uint16/uint24 helpers (WebP is little-endian). */
function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
function readU24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

/**
 * PNG: the IHDR chunk is mandated to be first, so width/height sit at fixed
 * offsets 16 and 20 (8 signature + 4 length + 4 type).
 */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
}

/**
 * JPEG: walk the marker chain until a Start-Of-Frame carrying the dimensions.
 *
 * SOF0/1/2/3, 5/6/7, 9/10/11, 13/14/15 all describe a frame; 0xC4 (DHT), 0xC8
 * (JPG extension) and 0xCC (DAC) share the 0xCn range but are NOT frame headers
 * and must be skipped, which is why they are excluded explicitly rather than
 * matching the whole 0xC0-0xCF block.
 */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2; // skip SOI
  while (offset + 9 < bytes.length) {
    // Markers are 0xFF followed by a non-0xFF, non-zero type byte. Fill bytes
    // (0xFF padding) are legal between segments — skip them.
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff || marker === 0x00) {
      offset += 1;
      continue;
    }
    // Standalone markers with no length field.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = readU16BE(bytes, offset + 2);
    if (length < 2) return null;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      // SOF payload: precision(1) height(2) width(2)
      if (offset + 9 >= bytes.length) return null;
      return {
        height: readU16BE(bytes, offset + 5),
        width: readU16BE(bytes, offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * WebP: three container flavours, each storing the size differently.
 *   VP8  (lossy)    — 14-bit width/height at 26/28, after a 3-byte start code
 *   VP8L (lossless) — 14-bit each, bit-packed into a 32-bit LE word at 21
 *   VP8X (extended) — 24-bit MINUS ONE canvas size at 24/27
 */
function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  const fourcc = String.fromCharCode(
    bytes[12],
    bytes[13],
    bytes[14],
    bytes[15],
  );

  if (fourcc === "VP8 ") {
    // 0x9d012a is the VP8 keyframe start code; dimensions follow it.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return null;
    }
    return {
      width: readU16LE(bytes, 26) & 0x3fff,
      height: readU16LE(bytes, 28) & 0x3fff,
    };
  }

  if (fourcc === "VP8L") {
    if (bytes[20] !== 0x2f) return null; // VP8L signature byte
    // 32 little-endian bits at offset 21 pack: width-1 (14b), height-1 (14b),
    // alpha (1b), version (3b). `>>> 0` keeps it unsigned — the top byte shifted
    // left by 24 would otherwise make the value negative.
    const packed =
      ((bytes[21] |
        (bytes[22] << 8) |
        (bytes[23] << 16) |
        (bytes[24] << 24)) >>>
        0);
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >>> 14) & 0x3fff) + 1,
    };
  }

  if (fourcc === "VP8X") {
    return {
      width: readU24LE(bytes, 24) + 1,
      height: readU24LE(bytes, 27) + 1,
    };
  }

  return null;
}

/**
 * Sniff the type and read the pixel dimensions in one pass. Returns `null` when
 * the bytes are not an accepted image, are truncated before the header, or
 * report a zero dimension (which a corrupt header can).
 */
export function readImageMeta(bytes: Uint8Array): ImageMeta | null {
  const type = sniffImageType(bytes);
  if (!type) return null;

  const size =
    type === "image/png"
      ? pngSize(bytes)
      : type === "image/jpeg"
        ? jpegSize(bytes)
        : webpSize(bytes);

  if (!size) return null;
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return null;
  if (size.width <= 0 || size.height <= 0) return null;
  return { type, width: size.width, height: size.height };
}

/** File extension to use for a stored blob of this type. */
export function extensionForType(type: ImageType): string {
  return type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "webp";
}

// ---------------------------------------------------------------------------
// Upload policy
// ---------------------------------------------------------------------------

/** Per-file cap. Five of these fit inside the 25 MB server-action body limit. */
export const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
/** Files accepted in a single upload submission. */
export const MAX_MEDIA_PER_UPLOAD = 5;
/** Images retained per game. */
export const MAX_MEDIA_PER_SLUG = 8;
/** Below this a "screenshot" is a thumbnail and looks broken in a 16:9 frame. */
export const MIN_MEDIA_WIDTH = 640;
/** Keeps portrait phone screenshots out of a landscape gallery. */
export const MIN_MEDIA_ASPECT = 1.2;
export const MAX_MEDIA_ASPECT = 2.2;

export type MediaRejection =
  | "empty"
  | "too-large"
  | "not-an-image"
  | "too-narrow"
  | "bad-aspect";

export type MediaValidation =
  | { ok: true; meta: ImageMeta; bytes: number }
  | { ok: false; reason: MediaRejection };

/**
 * The whole accept/reject decision for one uploaded file, as a discriminated
 * union so the caller can map each reason to its own message — the same shape
 * `parseCreateBoardInput` uses in `scoreboard/board-input.ts`.
 *
 * Order matters: size is checked before decoding so a huge file is rejected
 * without walking its bytes, and the type check precedes the dimension checks
 * because dimensions are meaningless for something that is not an image.
 */
export function validateMediaUpload(bytes: Uint8Array): MediaValidation {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_MEDIA_BYTES) return { ok: false, reason: "too-large" };

  const meta = readImageMeta(bytes);
  if (!meta) return { ok: false, reason: "not-an-image" };

  if (meta.width < MIN_MEDIA_WIDTH) return { ok: false, reason: "too-narrow" };

  const aspect = meta.width / meta.height;
  if (aspect < MIN_MEDIA_ASPECT || aspect > MAX_MEDIA_ASPECT) {
    return { ok: false, reason: "bad-aspect" };
  }

  return { ok: true, meta, bytes: bytes.length };
}
