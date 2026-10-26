/**
 * The shape and texture of the foil, independent of the print:
 *
 *   pillowZ    the pouch's puff: flat at the crimp seals and the side folds,
 *              rounded in between (geometry, in pack-width units)
 *   normalMap  fine detail as a tangent-space normal map: soft crinkles, sharp
 *              creases (with fans of stress wrinkles at the four corners, as a
 *              real stuffed pouch has), gathers beside each seal, and the
 *              ridged crimp bands
 *
 * Generated once per pack from a seed, so a pack keeps its wrinkles. Pure apart
 * from returning plain arrays.
 */

import { hash1, noise1, noise2 } from "../noise";
import { CRIMP_BOTTOM, CRIMP_TOP, PACK_ASPECT } from "./art";

/** How far the pouch puffs toward the viewer at its fullest, in pack widths. */
export const PUFF = 0.058;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The pouch's puff at (u, v): 0 at the seals and the side folds. */
export function pillowZ(u: number, v: number): number {
  const v0 = CRIMP_TOP;
  const v1 = 1 - CRIMP_BOTTOM;
  if (v <= v0 || v >= v1 || u <= 0 || u >= 1) return 0;
  const t = (v - v0) / (v1 - v0);
  const across = Math.pow(Math.sin(Math.PI * u), 0.55);
  const down = Math.pow(Math.sin(Math.PI * t), 0.42);
  return PUFF * across * down;
}

interface Crease {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  amp: number;
}

function creases(seed: number): Crease[] {
  const out: Crease[] = [];
  const r = (i: number) => hash1(i, seed);
  let k = 0;
  const top = CRIMP_TOP * PACK_ASPECT;
  const bottom = (1 - CRIMP_BOTTOM) * PACK_ASPECT;
  // Stress wrinkles fanning in from each corner of the pouch.
  for (const [cx, cy, dx, dy] of [
    [0, top, 1, 1],
    [1, top, -1, 1],
    [0, bottom, 1, -1],
    [1, bottom, -1, -1],
  ] as const) {
    const n = 2 + Math.floor(r(k++) * 3);
    for (let i = 0; i < n; i++) {
      const ang = 0.3 + r(k++) * 0.85;
      const len = 0.05 + r(k++) * 0.11;
      const sx = cx + dx * (0.01 + r(k++) * 0.06);
      const sy = cy + dy * (0.004 + r(k++) * 0.03);
      out.push({ x0: sx, y0: sy, x1: sx + dx * Math.cos(ang) * len, y1: sy + dy * Math.sin(ang) * len, width: 0.014 + r(k++) * 0.016, amp: 0.22 + r(k++) * 0.25 });
    }
  }
  // A few long soft creases across the face, where the pack was handled.
  for (let i = 0; i < 4; i++) {
    const x = 0.15 + r(k++) * 0.7;
    const y = top + 0.15 + r(k++) * (bottom - top - 0.3);
    const ang = r(k++) * Math.PI;
    const len = 0.12 + r(k++) * 0.26;
    out.push({ x0: x, y0: y, x1: x + Math.cos(ang) * len, y1: y + Math.sin(ang) * len, width: 0.03 + r(k++) * 0.035, amp: (r(k++) > 0.5 ? 1 : -1) * (0.14 + r(k++) * 0.16) });
  }
  return out;
}

/**
 * A tangent-space normal map (RGBA bytes, x right, y UP, z out; alpha 255) of
 * `width` × round(width × PACK_ASPECT) texels.
 */
export function normalMap(width: number, seed: number, strength = 1): { data: Uint8Array; width: number; height: number } {
  const w = Math.max(16, Math.round(width));
  const h = Math.round(w * PACK_ASPECT);
  const height = new Float32Array(w * h);
  const list = creases(seed);
  const top = CRIMP_TOP;
  const bottom = 1 - CRIMP_BOTTOM;

  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const py = v * PACK_ASPECT;
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      let z: number;
      if (v < top || v > bottom) {
        // Crimp: fine vertical ridges pressed into the seal, slightly irregular.
        const ridge = Math.abs(((u * 52 + noise1(v * 40, seed) * 0.15) % 1) - 0.5) * 2;
        z = 0.55 * Math.pow(ridge, 1.6) + noise2(u * 60, v * 30, seed + 9) * 0.05;
      } else {
        // Soft crinkle: the foil is never flat.
        z = noise2(u * 4, v * 6, seed) * 0.26 + noise2(u * 11, v * 16, seed + 1) * 0.08;
        // Crumpled film: ridged noise gives the sharp little folds foil has.
        const r1 = 1 - Math.abs(noise2(u * 9, v * 13, seed + 2));
        const r2 = 1 - Math.abs(noise2(u * 23, v * 34, seed + 3));
        z += r1 * r1 * 0.1 + r2 * r2 * 0.035;
        // Gathers beside each seal, where the pouch is pulled into the crimp.
        const dTop = (v - top) * PACK_ASPECT;
        const dBot = (bottom - v) * PACK_ASPECT;
        z += noise1(u * 26, seed + 4) * 0.45 * Math.exp(-((dTop / 0.022) ** 2));
        z += noise1(u * 22, seed + 5) * 0.4 * Math.exp(-((dBot / 0.022) ** 2));
        // Creases: sharp ridges (or valleys), tapered at both ends.
        for (const c of list) {
          const ex = c.x1 - c.x0;
          const ey = c.y1 - c.y0;
          const len2 = ex * ex + ey * ey;
          const t = Math.min(1, Math.max(0, ((u - c.x0) * ex + (py - c.y0) * ey) / len2));
          const dx = u - (c.x0 + ex * t);
          const dy = py - (c.y0 + ey * t);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < c.width) z += c.amp * Math.pow(1 - d / c.width, 2) * Math.sin(Math.PI * t);
        }
      }
      height[y * w + x] = z;
    }
  }

  const data = new Uint8Array(w * h * 4);
  // Height differences are in "texel heights"; scale them to a pleasing slope.
  const k = (strength * w) / 90;
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(w - 1, x + 1);
      const dx = (height[y * w + xp] - height[y * w + xm]) * k;
      const dy = (height[yp * w + x] - height[ym * w + x]) * k;
      // x right, y up (rows run down, so the y slope flips), z out of the surface.
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const i = (y * w + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

export { smooth };
