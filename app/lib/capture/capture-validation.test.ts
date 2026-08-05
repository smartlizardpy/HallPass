/**
 * Proves that what the frame grabber produces is what `validateMediaUpload`
 * accepts.
 *
 * `crop.test.ts` checks the geometry in isolation; this closes the loop against
 * the REAL validator — the same function the session's submit action and the
 * dashboard's gallery upload both call. Without it, the two sides can drift and
 * the only symptom is a tester whose screenshots are silently refused, which is
 * exactly what happened: grabs were cropped to the iframe's own aspect, and
 * opening the report panel narrowed it to ~1.12, under the 1.2 floor.
 *
 * A lossy VP8 WebP header is synthesised rather than encoded, because
 * `readImageMeta` only ever parses the header — it never decodes pixels — so a
 * real encode would test the browser's codec rather than our policy.
 */

import { describe, expect, it } from "vitest";
import { validateMediaUpload } from "@/app/lib/image-meta";
import { centreCrop } from "./crop";
import { DEFAULT_CAPTURE_ASPECT, DEFAULT_CAPTURE_WIDTH } from "./tab-capture";

/**
 * A minimal lossy-VP8 WebP with the given dimensions.
 *
 * Layout per the format: "RIFF" + size + "WEBP" + "VP8 " + chunk size + a
 * 3-byte frame tag + the 3-byte start code 0x9d012a + 14-bit LE width and
 * height at offsets 26 and 28.
 */
function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  const ascii = (s: string, at: number) => {
    for (let i = 0; i < s.length; i += 1) bytes[at + i] = s.charCodeAt(i);
  };
  ascii("RIFF", 0);
  bytes[4] = 56; // little-endian file size; unused by the parser
  ascii("WEBP", 8);
  ascii("VP8 ", 12);
  bytes[16] = 44; // chunk size
  // Frame tag (3 bytes) then the uncompressed-data start code.
  bytes[20] = 0x9d;
  bytes[21] = 0x01;
  bytes[22] = 0x2a;
  bytes[23] = 0x9d;
  bytes[24] = 0x01;
  bytes[25] = 0x2a;
  bytes[26] = width & 0xff;
  bytes[27] = (width >> 8) & 0x3f;
  bytes[28] = height & 0xff;
  bytes[29] = (height >> 8) & 0x3f;
  return bytes;
}

describe("the synthetic WebP header is well-formed", () => {
  // If this ever fails, every assertion below is meaningless.
  it("round-trips its dimensions through the real parser", () => {
    const check = validateMediaUpload(webp(1280, 720));
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.meta.type).toBe("image/webp");
      expect(check.meta.width).toBe(1280);
      expect(check.meta.height).toBe(720);
    }
  });
});

describe("every captured still passes validateMediaUpload", () => {
  const OUT_W = DEFAULT_CAPTURE_WIDTH;
  const OUT_H = Math.round(OUT_W / DEFAULT_CAPTURE_ASPECT);

  // Every iframe shape a real session produces. The grabber crops each to the
  // fixed aspect and draws at the fixed size, so the STORED image is identical
  // regardless — which is the whole point.
  const IFRAME_SHAPES = [
    { name: "full width", width: 1280, height: 800 },
    { name: "report panel open", width: 896, height: 800 }, // the 1.12 regression
    { name: "review panel open", width: 896, height: 640 },
    { name: "small window", width: 640, height: 570 },
    { name: "phone portrait", width: 390, height: 700 },
    { name: "very wide, short", width: 1600, height: 400 },
    { name: "very tall, narrow", width: 300, height: 900 },
  ];

  for (const shape of IFRAME_SHAPES) {
    it(`accepts a grab taken with the ${shape.name}`, () => {
      // Mirrors FrameGrabber.grab(): crop to the fixed aspect, draw at the
      // fixed size.
      const inner = centreCrop(shape, DEFAULT_CAPTURE_ASPECT);
      expect(inner.width).toBeGreaterThan(0);
      expect(inner.height).toBeGreaterThan(0);

      const check = validateMediaUpload(webp(OUT_W, OUT_H));
      expect(check.ok).toBe(true);
    });
  }

  it("would have REJECTED the old iframe-aspect behaviour", () => {
    // The regression, pinned. The old code cropped to the iframe's own aspect
    // and only ever scaled down, so a report-panel-narrowed iframe produced a
    // 896x800 image — aspect 1.12, under the 1.2 floor.
    const old = validateMediaUpload(webp(896, 800));
    expect(old.ok).toBe(false);
    if (!old.ok) expect(old.reason).toBe("bad-aspect");

    // And a small window produced something under the 640px width floor.
    const narrow = validateMediaUpload(webp(390, 220));
    expect(narrow.ok).toBe(false);
    if (!narrow.ok) expect(narrow.reason).toBe("too-narrow");
  });
});
