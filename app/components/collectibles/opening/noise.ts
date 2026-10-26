/**
 * Tiny seeded noise for the pack: the torn edge's jaggedness and the foil's
 * crinkles. Deterministic per seed, so a pack keeps the same wrinkles between
 * frames and the same torn edge in the WebGL and DOM renderers. Pure.
 */

/** A hash of (i, seed) into [0, 1). */
export function hash1(i: number, seed = 0): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A hash of (x, y, seed) into [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  return hash1((x | 0) * 73856093 + (y | 0) * 19349663, seed);
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Smooth 1-D value noise in [-1, 1]. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = fade(x - i);
  return (hash1(i, seed) * (1 - f) + hash1(i + 1, seed) * f) * 2 - 1;
}

/** Smooth 2-D value noise in [-1, 1]. */
export function noise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = fade(x - xi);
  const fy = fade(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) * 2 - 1;
}

/** A stable small integer seed from a string (a pack's public id). */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}
