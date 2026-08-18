/**
 * HallPass — the link builder's QR CODE.
 *
 * `marketing-design.md` §5 promised the builder would hand back "the tagged
 * URL, a QR code, and the OG card"; the first and third shipped and this is the
 * missing one. It matters more than it looks: the `qr` and `poster` channels in
 * `channels.ts` describe links that are never clicked at all — scanned off a
 * screen at the front of a room, or off a sheet of paper — and until now the
 * person making that poster had to take our URL to some random QR site, which
 * hands a marketing URL to a third party and often bakes in a redirect that
 * outlives the free tier.
 *
 * WHY A DEPENDENCY. `uqr` is ~100 KB on disk, has no dependencies of its own,
 * and implements the parts of ISO/IEC 18004 that nobody should hand-roll under
 * time pressure — Reed-Solomon error correction, version selection and mask
 * scoring. The alternative was several hundred lines of bit manipulation whose
 * failure mode is a code that scans on the machine it was written on and not on
 * a five-year-old Android in a classroom.
 *
 * WHY A PATH RATHER THAN `uqr`'s OWN `renderSVG`. That helper returns a string
 * of markup, which a React component can only mount through
 * `dangerouslySetInnerHTML`. Returning the geometry instead lets the component
 * render real elements, and lets the download and the on-screen code come from
 * one description rather than two that can drift.
 *
 * Pure and server-safe: no DOM, no canvas, so it renders identically in a test,
 * on the server and in the browser.
 */

import { encode } from "uqr";

/** A QR code as geometry: a square grid, and the dark modules within it. */
export type QrCode = {
  /** Grid width in modules, INCLUDING the quiet zone. Use as the viewBox. */
  size: number;
  /** SVG path data covering every dark module, one unit per module. */
  path: string;
};

/**
 * The quiet zone, in modules.
 *
 * The specification asks for four and `uqr` defaults to one. Two is the
 * deliberate middle: a scanner needs *some* margin to find the symbol, and the
 * card this renders into supplies white space of its own around the image, so
 * paying four modules out of the drawing area would shrink the modules
 * themselves for no gain. Anyone printing this at poster size gets the margin
 * from the page.
 */
const QUIET_ZONE = 2;

/**
 * Error correction level M — recovers 15% damage.
 *
 * L would give slightly larger modules for the same picture; M survives a
 * thumbprint, a fold and the glare off a projector, which is precisely the
 * population of surfaces these codes end up on. H is for logos overlaid on the
 * code, which we do not do.
 */
const ECC = "M" as const;

/**
 * Encode text as QR geometry.
 *
 * Throws only if the content cannot fit any QR version — around 2,300 bytes at
 * this correction level, which no URL this builder produces approaches.
 */
export function qrCode(text: string): QrCode {
  const result = encode(text, { ecc: ECC, border: QUIET_ZONE });

  const parts: string[] = [];
  for (let row = 0; row < result.size; row++) {
    for (let col = 0; col < result.size; col++) {
      // `data` is indexed [row][col]; SVG wants x then y.
      if (result.data[row][col]) parts.push(`M${col} ${row}h1v1h-1z`);
    }
  }

  return { size: result.size, path: parts.join("") };
}

/**
 * The same code as a standalone SVG file, for downloading.
 *
 * Vector rather than PNG on purpose: this is going onto a poster at a size
 * nobody has decided yet, and a resolution chosen here would be the wrong one.
 * An explicit white rectangle rather than a transparent background, because a
 * QR code inverted by a dark-themed viewer, or printed onto coloured card, does
 * not scan.
 */
export function qrSvgDocument(code: QrCode): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${code.size} ${code.size}" shape-rendering="crispEdges">`,
    `<rect width="${code.size}" height="${code.size}" fill="#ffffff"/>`,
    `<path d="${code.path}" fill="#000000"/>`,
    `</svg>`,
  ].join("");
}
