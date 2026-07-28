/**
 * Tests for `image-meta.ts`.
 *
 * The fixtures are hand-built byte arrays rather than files on disk: the module's
 * whole job is byte arithmetic over image headers, so constructing the exact
 * header layout in the test is what actually pins the offsets down. A real .png
 * checked into the repo would test that one file, not the format.
 */

import { describe, expect, it } from "vitest";
import {
  extensionForType,
  readImageMeta,
  sniffImageType,
  validateMediaUpload,
  MAX_MEDIA_BYTES,
} from "./image-meta";

/** PNG: 8-byte signature, IHDR length+type, then width/height as BE uint32. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR length = 13
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

/**
 * JPEG: SOI, an APP0 segment to prove the walker skips segments correctly, then
 * an SOF0 carrying height then width (in that order — it is easy to swap).
 */
function jpeg(
  width: number,
  height: number,
  { marker = 0xc0, extraSegments = 1 } = {},
): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  for (let i = 0; i < extraSegments; i += 1) {
    parts.push(0xff, 0xe0, 0x00, 0x08, 1, 2, 3, 4, 5, 6); // APP0, length 8
  }
  parts.push(0xff, marker, 0x00, 0x11, 0x08);
  parts.push((height >> 8) & 0xff, height & 0xff);
  parts.push((width >> 8) & 0xff, width & 0xff);
  parts.push(...new Array(8).fill(0));
  return new Uint8Array(parts);
}

/** WebP lossy (VP8 ): dimensions as 14-bit LE after the 0x9d012a start code. */
function webpLossy(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  b.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  b.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  b.set([0x9d, 0x01, 0x2a], 23);
  b[26] = width & 0xff;
  b[27] = (width >> 8) & 0x3f;
  b[28] = height & 0xff;
  b[29] = (height >> 8) & 0x3f;
  return b;
}

/** WebP lossless (VP8L): width-1 and height-1 packed into 32 LE bits at 21. */
function webpLossless(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set([0x56, 0x50, 0x38, 0x4c], 12); // "VP8L"
  b[20] = 0x2f;
  const packed = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  b[21] = packed & 0xff;
  b[22] = (packed >>> 8) & 0xff;
  b[23] = (packed >>> 16) & 0xff;
  b[24] = (packed >>> 24) & 0xff;
  return b;
}

/** WebP extended (VP8X): 24-bit LE canvas size minus one at 24 and 27. */
function webpExtended(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  const w = width - 1;
  const h = height - 1;
  b[24] = w & 0xff;
  b[25] = (w >> 8) & 0xff;
  b[26] = (w >> 16) & 0xff;
  b[27] = h & 0xff;
  b[28] = (h >> 8) & 0xff;
  b[29] = (h >> 16) & 0xff;
  return b;
}

describe("sniffImageType", () => {
  it("identifies the three accepted formats", () => {
    expect(sniffImageType(png(10, 10))).toBe("image/png");
    expect(sniffImageType(jpeg(10, 10))).toBe("image/jpeg");
    expect(sniffImageType(webpLossy(10, 10))).toBe("image/webp");
  });

  it("rejects SVG — it is scriptable and would be an XSS vector same-origin", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">');
    expect(sniffImageType(svg)).toBeNull();
  });

  it("rejects GIF and BMP even though they are images", () => {
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x42, 0x4d, 0, 0, 0, 0]))).toBeNull();
  });

  it("does not mistake other RIFF containers for WebP", () => {
    // "RIFF....WAVE" — same container, different payload.
    const wav = new Uint8Array(16);
    wav.set([0x52, 0x49, 0x46, 0x46], 0);
    wav.set([0x57, 0x41, 0x56, 0x45], 8);
    expect(sniffImageType(wav)).toBeNull();
  });

  it("rejects empty and truncated input without throwing", () => {
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe("readImageMeta", () => {
  it("reads PNG dimensions", () => {
    expect(readImageMeta(png(1280, 720))).toEqual({
      type: "image/png",
      width: 1280,
      height: 720,
    });
  });

  it("reads JPEG dimensions, skipping preceding segments", () => {
    expect(readImageMeta(jpeg(1920, 1080, { extraSegments: 3 }))).toEqual({
      type: "image/jpeg",
      width: 1920,
      height: 1080,
    });
  });

  it("reads progressive JPEG (SOF2), not just baseline", () => {
    expect(readImageMeta(jpeg(800, 600, { marker: 0xc2 }))?.width).toBe(800);
  });

  it("does not treat DHT/DAC/JPG-extension as a frame header", () => {
    // 0xC4, 0xC8 and 0xCC sit in the 0xCn range but carry no dimensions.
    for (const marker of [0xc4, 0xc8, 0xcc]) {
      const bytes = jpeg(640, 480, { marker });
      expect(readImageMeta(bytes)).toBeNull();
    }
  });

  it("reads all three WebP flavours", () => {
    expect(readImageMeta(webpLossy(1024, 768))).toEqual({
      type: "image/webp",
      width: 1024,
      height: 768,
    });
    expect(readImageMeta(webpLossless(1024, 768))).toEqual({
      type: "image/webp",
      width: 1024,
      height: 768,
    });
    expect(readImageMeta(webpExtended(4000, 3000))).toEqual({
      type: "image/webp",
      width: 4000,
      height: 3000,
    });
  });

  it("handles VP8L dimensions whose packed word has the high bit set", () => {
    // height-1 near the 14-bit max pushes bit 31 high; an unsigned shift is
    // required or the height comes back negative.
    const meta = readImageMeta(webpLossless(1000, 16000));
    expect(meta?.height).toBe(16000);
  });

  it("returns null for a zero dimension", () => {
    expect(readImageMeta(png(0, 100))).toBeNull();
    expect(readImageMeta(png(100, 0))).toBeNull();
  });

  it("returns null when the header is truncated", () => {
    expect(readImageMeta(png(100, 100).slice(0, 20))).toBeNull();
  });
});

describe("validateMediaUpload", () => {
  it("accepts a normal landscape screenshot", () => {
    const result = validateMediaUpload(png(1280, 720));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta.width).toBe(1280);
      expect(result.bytes).toBeGreaterThan(0);
    }
  });

  it("rejects an empty file", () => {
    expect(validateMediaUpload(new Uint8Array(0))).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("rejects oversized files before attempting to decode them", () => {
    // Deliberately NOT a valid image: the size gate must fire first, proving we
    // never walk the bytes of something huge.
    const huge = new Uint8Array(MAX_MEDIA_BYTES + 1);
    expect(validateMediaUpload(huge)).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("rejects non-images", () => {
    const text = new TextEncoder().encode("not an image at all");
    expect(validateMediaUpload(text)).toEqual({
      ok: false,
      reason: "not-an-image",
    });
  });

  it("rejects images narrower than the gallery frame", () => {
    expect(validateMediaUpload(png(320, 200))).toEqual({
      ok: false,
      reason: "too-narrow",
    });
  });

  it("rejects portrait and ultrawide aspect ratios", () => {
    expect(validateMediaUpload(png(720, 1280))).toEqual({
      ok: false,
      reason: "bad-aspect",
    });
    expect(validateMediaUpload(png(3840, 800))).toEqual({
      ok: false,
      reason: "bad-aspect",
    });
  });

  it("accepts the aspect-ratio boundaries", () => {
    expect(validateMediaUpload(png(1200, 1000)).ok).toBe(true); // 1.2
    expect(validateMediaUpload(png(2200, 1000)).ok).toBe(true); // 2.2
  });
});

describe("extensionForType", () => {
  it("maps each type to its stored extension", () => {
    expect(extensionForType("image/png")).toBe("png");
    expect(extensionForType("image/jpeg")).toBe("jpg");
    expect(extensionForType("image/webp")).toBe("webp");
  });
});
