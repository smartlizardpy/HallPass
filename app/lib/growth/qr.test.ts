import { describe, expect, it } from "vitest";
import { qrCode, qrSvgDocument } from "./qr";

const URL_LIKE = "https://hallpass-rouge.vercel.app/game/duskfall?ref=qr";

describe("qrCode", () => {
  /**
   * Every QR version is 21 + 4(v-1) modules square, plus the quiet zone on both
   * sides. Checking the arithmetic rather than a fixed number keeps this true if
   * the content ever needs a bigger version.
   */
  it("returns a square grid of a legal QR size", () => {
    for (const text of ["x", URL_LIKE, "a".repeat(300)]) {
      const { size } = qrCode(text);
      const modules = size - 4; // both quiet zones
      expect(modules).toBeGreaterThanOrEqual(21);
      expect((modules - 21) % 4).toBe(0);
    }
  });

  it("grows the grid as the content grows", () => {
    expect(qrCode("a".repeat(300)).size).toBeGreaterThan(qrCode("x").size);
  });

  /**
   * The three finder patterns — the big squares a scanner locks onto — sit at
   * the corners of the symbol, just inside the quiet zone. Their outer corner
   * module is dark in every QR code ever made, so this catches a path drawn
   * with x and y transposed or the quiet zone applied twice.
   */
  it("puts a dark module at each finder corner, inside the quiet zone", () => {
    const { size, path } = qrCode(URL_LIKE);
    const last = size - 3; // quiet zone (2) + one module in from the far edge
    expect(path).toContain("M2 2h1v1h-1z");
    expect(path).toContain(`M${last} 2h1v1h-1z`);
    expect(path).toContain(`M2 ${last}h1v1h-1z`);
  });

  it("leaves the quiet zone empty", () => {
    const { size, path } = qrCode(URL_LIKE);
    expect(path).not.toContain("M0 0h1v1h-1z");
    expect(path).not.toContain("M1 1h1v1h-1z");
    expect(path).not.toContain(`M${size - 1} ${size - 1}h1v1h-1z`);
  });

  /** A code that changed between the preview and the download would be a lie. */
  it("is deterministic", () => {
    expect(qrCode(URL_LIKE)).toEqual(qrCode(URL_LIKE));
  });
});

describe("qrSvgDocument", () => {
  it("wraps the geometry in a standalone, white-backed SVG", () => {
    const code = qrCode(URL_LIKE);
    const svg = qrSvgDocument(code);
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${code.size} ${code.size}"`);
    expect(svg).toContain(code.path);
    // A transparent background inverts on dark card, and an inverted code does
    // not scan.
    expect(svg).toContain('fill="#ffffff"');
    expect(svg.endsWith("</svg>")).toBe(true);
  });
});
