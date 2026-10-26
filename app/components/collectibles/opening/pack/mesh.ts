/**
 * The pack as two meshes over the same print, and how they bend.
 *
 *   body   the pouch below the torn edge (it keeps the cards)
 *   strip  the top seal above it (it comes off)
 *
 * Both cover a band around the seam and the fragment shader cuts each along the
 * torn edge (by texture coordinate, so the cut stays on the material however
 * the strip bends). Where the seal is still whole the two pieces are coplanar
 * and complementary, so the join is invisible.
 *
 * The torn part of the strip is a bent ribbon hinged at the tear's front: it
 * curls toward the viewer, rises (more when the finger pulls up) and twists a
 * little, all growing from zero at the front, so the untorn part never moves.
 * Positions are in pack-width units: x across (−0.5..0.5), y up, z toward the
 * viewer; the pack's centre is the origin.
 */

import { TEAR, type TearSide } from "../tear";
import { PACK_ASPECT } from "./art";
import { pillowZ, smooth } from "./surface";

export const NX = 40;
const BODY_V0 = TEAR.seamMinV - 0.04;
const STRIP_V1 = TEAR.seamMaxV + 0.04;
const BODY_ROWS = 46;
const STRIP_ROWS = 12;

/** 3 pos + 3 normal + 3 tangent + 2 uv. */
export const STRIDE = 11;

export interface Part {
  verts: Float32Array;
  index: Uint16Array;
  cols: number;
  rows: number;
  v0: number;
  v1: number;
}

export interface Bend {
  side: TearSide | null;
  /** 0..1 along the seal from `side` (the visible front, already smoothed). */
  front: number;
  /** 0 flat .. 1 fully peeled. */
  curl: number;
  /** The finger pulling up, 0..1. */
  lift: number;
  /** Seam heights left → right (from `seamLine`). */
  seam: Float32Array;
  /** The mouth easing open after the strip is off, 0..1. */
  loosen: number;
  /** A fingertip pressing the foil in: where, and how deep (pack widths). */
  dent: { u: number; v: number; depth: number };
}

function grid(cols: number, rows: number, v0: number, v1: number): Part {
  const verts = new Float32Array((cols + 1) * (rows + 1) * STRIDE);
  const index = new Uint16Array(cols * rows * 6);
  let k = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      index.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const o = (j * (cols + 1) + i) * STRIDE;
      verts[o + 9] = i / cols;
      verts[o + 10] = v0 + ((v1 - v0) * j) / rows;
    }
  }
  return { verts, index, cols, rows, v0, v1 };
}

export function createParts(): { body: Part; strip: Part } {
  return { body: grid(NX, BODY_ROWS, BODY_V0, 1), strip: grid(NX, STRIP_ROWS, 0, STRIP_V1) };
}

const restX = (u: number) => u - 0.5;
const restY = (v: number) => (0.5 - v) * PACK_ASPECT;

function dentZ(u: number, v: number, d: Bend["dent"]): number {
  if (d.depth <= 0) return 0;
  const du = u - d.u;
  const dv = (v - d.v) * PACK_ASPECT;
  return -d.depth * Math.exp(-(du * du + dv * dv) / (2 * 0.13 * 0.13));
}

/** The seam height at u (left → right), interpolated. */
function seamAt(seam: Float32Array, u: number): number {
  const x = Math.min(1, Math.max(0, u)) * (seam.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return seam[i] * (1 - f) + seam[Math.min(i + 1, seam.length - 1)] * f;
}

/** Rest position of a vertex (pouch puff + any dent). */
function rest(u: number, v: number, b: Bend): [number, number, number] {
  return [restX(u), restY(v), pillowZ(u, v) + dentZ(u, v, b.dent)];
}

type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * The bent ribbon: centreline and frame at distance s behind the front, built by
 * integrating the heading from the hinge. Returns samples every `ds`.
 */
function ribbon(b: Bend, sMax: number, ds: number) {
  const dir = b.side === "right" ? 1 : -1;
  // The torn part rises (more while the finger pulls up), but its free end never
  // climbs more than about a third of a pack width above the hinge.
  const want = b.curl * (0.3 + 0.55 * Math.min(1, Math.max(0, b.lift * 4)));
  const reach = Math.max(0.05, sMax * Math.cos(Math.min(1.2, b.curl)));
  const raise = Math.min(want, Math.asin(Math.min(1, 0.3 / reach)));
  const pts: { p: V3; t: V3; up: V3; n: V3 }[] = [];
  let p: V3 = [0, 0, 0];
  const steps = Math.max(1, Math.ceil(sMax / ds));
  for (let k = 0; k <= steps; k++) {
    const s = k * ds;
    const th = raise * smooth(0, 0.2, s);
    const ph = b.curl * 1.0 * (1 - Math.exp(-s / 0.085));
    const ps = b.curl * 0.6 * s;
    const t = norm([dir * Math.cos(th) * Math.cos(ph), Math.sin(th) * Math.cos(ph), Math.sin(ph)]);
    let up: V3 = [-dir * Math.sin(th), Math.cos(th), 0];
    const dot = up[0] * t[0] + up[1] * t[1] + up[2] * t[2];
    up = norm([up[0] - dot * t[0], up[1] - dot * t[1], up[2] - dot * t[2]]);
    let n = cross(up, t);
    if (dir > 0) n = [-n[0], -n[1], -n[2]];
    // Twist: the top edge leans toward the viewer.
    const upT = norm([up[0] * Math.cos(ps) + n[0] * Math.sin(ps), up[1] * Math.cos(ps) + n[1] * Math.sin(ps), up[2] * Math.cos(ps) + n[2] * Math.sin(ps)]);
    const nT = norm(cross(dir > 0 ? t : upT, dir > 0 ? upT : t));
    pts.push({ p: [...p] as V3, t, up: upT, n: nT });
    p = [p[0] + t[0] * ds, p[1] + t[1] * ds, p[2] + t[2] * ds];
  }
  return { pts, ds };
}

/** Recompute positions, normals and tangents of both parts for this bend. */
export function bendParts(parts: { body: Part; strip: Part }, b: Bend): void {
  // Body: rest shape, plus the mouth easing open (the lip folds forward and down) once the strip is off.
  placeGrid(parts.body, (u, v) => {
    const r = rest(u, v, b);
    if (b.loosen > 0) {
      const w = smooth(0.36, TEAR.seamV, v) * Math.pow(Math.sin(Math.PI * u), 0.7);
      r[1] -= b.loosen * 0.05 * w;
      r[2] += b.loosen * 0.05 * w;
    }
    return r;
  });

  // Strip: rest where untorn; a bent ribbon where torn.
  const side = b.side;
  const uFront = side === "right" ? 1 - b.front : b.front;
  const torn = side !== null && b.front > 0 && b.curl > 0.0005;
  const sMax = side === "right" ? 1 - uFront : uFront;
  const rib = torn ? ribbon(b, sMax + 0.05, 1 / 160) : null;
  const hingeV = torn ? seamAt(b.seam, uFront) : TEAR.seamV;
  const hinge: V3 = torn ? rest(uFront, hingeV, b) : [0, 0, 0];

  placeGrid(parts.strip, (u, v) => {
    const r = rest(u, v, b);
    if (!rib) return r;
    const s = side === "right" ? u - uFront : uFront - u;
    if (s <= 0) return r;
    const x = s / rib.ds;
    const i = Math.min(rib.pts.length - 2, Math.floor(x));
    const f = x - i;
    const A = rib.pts[i];
    const B = rib.pts[i + 1];
    const lerp = (a: V3, c: V3): V3 => [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f];
    const p = lerp(A.p, B.p);
    const up = lerp(A.up, B.up);
    const n = lerp(A.n, B.n);
    const h = r[1] - hinge[1];
    const zr = r[2] - hinge[2];
    return [hinge[0] + p[0] + up[0] * h + n[0] * zr, hinge[1] + p[1] + up[1] * h + n[1] * zr, hinge[2] + p[2] + up[2] * h + n[2] * zr];
  });
}

function placeGrid(part: Part, at: (u: number, v: number) => V3): void {
  const { verts, cols, rows } = part;
  const W = cols + 1;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const o = (j * W + i) * STRIDE;
      const p = at(verts[o + 9], verts[o + 10]);
      verts[o] = p[0];
      verts[o + 1] = p[1];
      verts[o + 2] = p[2];
    }
  }
  // Normals and tangents from neighbouring positions.
  const P = (i: number, j: number): V3 => {
    const o = (Math.min(rows, Math.max(0, j)) * W + Math.min(cols, Math.max(0, i))) * STRIDE;
    return [verts[o], verts[o + 1], verts[o + 2]];
  };
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const a = P(i + 1, j);
      const c = P(i - 1, j);
      const d = P(i, j + 1);
      const e = P(i, j - 1);
      const du: V3 = [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
      const dv: V3 = [d[0] - e[0], d[1] - e[1], d[2] - e[2]];
      // v runs down the pack: dv × du points out of the front face.
      const n = norm(cross(dv, du));
      const t = norm(du);
      const o = (j * W + i) * STRIDE;
      verts[o + 3] = n[0];
      verts[o + 4] = n[1];
      verts[o + 5] = n[2];
      verts[o + 6] = t[0];
      verts[o + 7] = t[1];
      verts[o + 8] = t[2];
    }
  }
}
