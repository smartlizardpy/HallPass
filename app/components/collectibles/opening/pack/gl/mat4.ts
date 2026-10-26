/** The few column-major 4×4 matrix operations the pack needs. */

export type Mat4 = Float32Array;

export const identity = (): Mat4 => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

export function rotationX(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

export function rotationY(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

export function rotationZ(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export const chain = (...ms: Mat4[]): Mat4 => ms.reduce((acc, m) => multiply(acc, m), identity());

/**
 * Perspective for a canvas `w`×`h` CSS px whose camera sits `dist` units in front
 * of the z = 0 plane, where one unit is `unitPx` CSS px: the pack (one unit wide)
 * renders exactly `unitPx` wide at rest, like CSS `perspective: dist × unitPx`.
 */
export function camera(w: number, h: number, unitPx: number, dist: number): Mat4 {
  const f = unitPx * dist;
  const near = 0.05;
  const far = dist + 4;
  const p = new Float32Array(16);
  p[0] = f / (w / 2);
  p[5] = f / (h / 2);
  p[10] = -(far + near) / (far - near);
  p[11] = -1;
  p[14] = (-2 * far * near) / (far - near);
  return multiply(p, translation(0, 0, -dist));
}

/** The upper-left 3×3 (rotation and uniform scale), for normals. */
export function normalMatrix(m: Mat4): Float32Array {
  return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
}

/** Transform a point. */
export function apply(m: Mat4, x: number, y: number, z: number): [number, number, number, number] {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14], m[3] * x + m[7] * y + m[11] * z + m[15]];
}
