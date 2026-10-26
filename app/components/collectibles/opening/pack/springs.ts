/**
 * Damped springs for everything that should feel physical: the pack's tilt and
 * its return to rest, the light following the pointer, the strip's curl, the
 * mouth loosening. Semi-implicit Euler, stable at the step sizes a frame gives
 * (dt is clamped by the caller). No library.
 */

export interface Spring {
  x: number;
  v: number;
  target: number;
  /** Stiffness (1/s²) and damping (1/s). */
  k: number;
  c: number;
}

export const spring = (x: number, k = 170, c = 22): Spring => ({ x, v: 0, target: x, k, c });

/** Advance one spring by dt seconds. Returns whether it is still moving. */
export function step(s: Spring, dt: number): boolean {
  const a = s.k * (s.target - s.x) - s.c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
  const moving = Math.abs(s.v) > 1e-4 || Math.abs(s.target - s.x) > 1e-4;
  if (!moving) {
    s.x = s.target;
    s.v = 0;
  }
  return moving;
}

/** Jump straight to a value, at rest. */
export function snap(s: Spring, x: number): void {
  s.x = x;
  s.v = 0;
  s.target = x;
}
