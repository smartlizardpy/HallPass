/**
 * The tear gesture, as a pure model: pointer samples in, tear state out. The
 * pack component feeds it pointer positions in PACK SPACE (u: 0 left → 1 right,
 * v: 0 top → 1 bottom, the untilted pack) and both renderers draw from it.
 *
 * Forgiving on purpose (docs/collectibles-opening.md §4.4), because many of the
 * people opening these are children on trackpads and phones:
 *   - a drag may start anywhere on the top band, not only at a notch;
 *   - the first few pixels decide the direction, and the tear then runs from
 *     that side, following the finger ALONG THE SEAL (not its straight-line
 *     distance) and never backwards: moving back just pauses it;
 *   - the finger may wander up and down; the torn edge follows it inside a band
 *     under the crimp, so the line is the player's own;
 *   - releasing early keeps what was torn (foil doesn't heal), and the next drag
 *     carries on from there;
 *   - it completes at the far edge with the finger still down, or on release
 *     past `commitAt`, or on a quick flick past `flickFrom`.
 */

import { noise1 } from "./noise";

export const TEAR = {
  /** A drag may start anywhere above this fraction of the pack's height. */
  zoneV: 0.27,
  /** Pixels of travel before a drag picks its direction. */
  engagePx: 7,
  /** Where the torn edge rests, and the band it may wander in to follow the finger. */
  seamV: 0.118,
  seamMinV: 0.088,
  seamMaxV: 0.162,
  /** Release past this completes the tear. */
  commitAt: 0.55,
  /** A flick past `flickFrom` faster than `flickSpeed` (seal widths per second) completes it too. */
  flickFrom: 0.18,
  flickSpeed: 2.2,
  /** Reaching this completes it with the finger still down. */
  edgeU: 0.96,
} as const;

/** Resolution of the torn edge across the pack. */
export const SEAM_COLS = 96;

export type TearSide = "left" | "right";
export interface TearPoint {
  /** 0 left → 1 right, across the untilted pack. */
  u: number;
  /** 0 top → 1 bottom. */
  v: number;
  /** ms */
  t: number;
}

export interface Tear {
  /** The side the tear runs from, once the drag has picked one. */
  side: TearSide | null;
  /** 0..1 along the seal from `side`. Never decreases. */
  progress: number;
  /** The finger's height where the tear passed, per column measured FROM `side` (NaN = not torn there yet). */
  heights: number[];
  dragging: boolean;
  start: TearPoint | null;
  last: TearPoint | null;
  /** Finger speed along the tear direction, seal widths per second, smoothed. */
  speed: number;
  /** How far the finger is above the torn edge (fraction of the pack's height): it pulls the strip up. */
  lift: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function emptyTear(): Tear {
  return { side: null, progress: 0, heights: new Array(SEAM_COLS).fill(Number.NaN), dragging: false, start: null, last: null, speed: 0, lift: 0 };
}

/** Whether a press here may start (or continue) a tear. */
export function inTearZone(p: { u: number; v: number }): boolean {
  return p.v <= TEAR.zoneV && p.v >= -0.08 && p.u >= -0.06 && p.u <= 1.06;
}

/** A press in the tear zone. Keeps the side and progress of an earlier, unfinished tear. */
export function pressTear(t: Tear, p: TearPoint): Tear {
  return { ...t, dragging: true, start: p, last: p, speed: 0, lift: 0 };
}

const along = (side: TearSide, u: number) => (side === "left" ? u : 1 - u);

/**
 * The finger moved. `widthPx` is the pack's on-screen width (for the engage
 * threshold). Returns the new state and how much progress this move added.
 */
export function dragTear(t: Tear, p: TearPoint, widthPx: number): { tear: Tear; advance: number } {
  if (!t.dragging || !t.start) return { tear: t, advance: 0 };
  let side = t.side;
  if (!side) {
    const dx = (p.u - t.start.u) * widthPx;
    if (Math.abs(dx) < TEAR.engagePx) return { tear: { ...t, last: p }, advance: 0 };
    side = dx > 0 ? "left" : "right";
  }
  const pos = clamp(along(side, p.u), 0, 1);
  const progress = Math.max(t.progress, pos);
  const advance = progress - t.progress;

  // The torn edge follows the finger's height across the columns it just tore.
  const heights = advance > 0 ? t.heights.slice() : t.heights;
  if (advance > 0) {
    const v = clamp(p.v, TEAR.seamMinV, TEAR.seamMaxV);
    const from = Math.max(0, Math.floor(t.progress * (SEAM_COLS - 1)));
    const to = Math.min(SEAM_COLS - 1, Math.ceil(progress * (SEAM_COLS - 1)));
    const prevV = Number.isNaN(t.heights[from]) ? v : t.heights[from];
    for (let i = from; i <= to; i++) {
      const k = to === from ? 1 : (i - from) / (to - from);
      if (Number.isNaN(heights[i]) || i > from) heights[i] = prevV + (v - prevV) * k;
    }
  }

  const last = t.last ?? p;
  const dt = Math.max(1, p.t - last.t);
  const instant = Math.max(0, ((pos - along(side, last.u)) / dt) * 1000);
  const speed = t.speed + (instant - t.speed) * 0.35;
  const edge = seamAt(heights, progress);
  const lift = clamp(edge - p.v, -0.2, 0.6);
  return { tear: { ...t, side, progress, heights, last: p, speed, lift }, advance };
}

/** The finger let go: complete the tear, or let the strip settle and keep what was torn. */
export function releaseTear(t: Tear): { tear: Tear; outcome: "commit" | "settle" } {
  const commit = t.progress >= TEAR.commitAt || (t.progress >= TEAR.flickFrom && t.speed >= TEAR.flickSpeed);
  return { tear: { ...t, dragging: false, lift: 0 }, outcome: commit ? "commit" : "settle" };
}

/** Far enough that the tear completes with the finger still down. */
export function reachedEdge(t: Tear): boolean {
  return t.progress >= TEAR.edgeU;
}

/** The finger's height at `progress` along the tear (the latest torn column, or the rest line). */
function seamAt(heights: number[], progress: number): number {
  const i = Math.min(SEAM_COLS - 1, Math.round(progress * (SEAM_COLS - 1)));
  for (let j = i; j >= 0; j--) if (!Number.isNaN(heights[j])) return heights[j];
  return TEAR.seamV;
}

/**
 * The torn edge across the whole pack, LEFT TO RIGHT, one height (v) per column:
 * the finger's line where it has torn (smoothed), easing back to the rest line
 * ahead of the tear, plus a fine deterministic jaggedness. Both renderers cut
 * along this, so the edge is the same whichever draws it.
 */
export function seamLine(t: Tear, seed: number, cols = SEAM_COLS): Float32Array {
  // Heights measured from the side → absolute columns, forward-filled.
  const base = new Float64Array(SEAM_COLS);
  let lastV: number = TEAR.seamV;
  for (let i = 0; i < SEAM_COLS; i++) {
    const h = t.heights[i];
    if (!Number.isNaN(h)) lastV = h;
    else lastV += (TEAR.seamV - lastV) * 0.08;
    base[i] = lastV;
  }
  const abs = new Float64Array(SEAM_COLS);
  for (let i = 0; i < SEAM_COLS; i++) abs[t.side === "right" ? SEAM_COLS - 1 - i : i] = base[i];
  // Smooth the finger's wobble into a tear, not a scribble.
  const smooth = new Float64Array(SEAM_COLS);
  for (let i = 0; i < SEAM_COLS; i++) {
    let s = 0;
    let w = 0;
    for (let k = -4; k <= 4; k++) {
      const j = clamp(i + k, 0, SEAM_COLS - 1);
      const wk = 5 - Math.abs(k);
      s += abs[j] * wk;
      w += wk;
    }
    smooth[i] = s / w;
  }
  const out = new Float32Array(cols);
  for (let c = 0; c < cols; c++) {
    const u = cols === 1 ? 0 : c / (cols - 1);
    const x = u * (SEAM_COLS - 1);
    const i = Math.floor(x);
    const f = x - i;
    const v = smooth[Math.min(i, SEAM_COLS - 1)] * (1 - f) + smooth[Math.min(i + 1, SEAM_COLS - 1)] * f;
    out[c] = v + jag(u, seed);
  }
  return out;
}

/** Fine jaggedness of a foil tear: a slow wander plus small irregular teeth (fractions of the pack's height). */
export function jag(u: number, seed: number): number {
  return noise1(u * 7, seed) * 0.006 + noise1(u * 31, seed + 7) * 0.0035 + noise1(u * 97, seed + 13) * 0.0016;
}

/** A believable hand path for the keyboard / button tear: k 0..1 → a point along the seal from the left. */
export function autoTearPoint(k: number, seed: number): { u: number; v: number } {
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  return { u: -0.02 + e * 1.04, v: TEAR.seamV + noise1(k * 3, seed + 3) * 0.012 - k * 0.01 };
}
