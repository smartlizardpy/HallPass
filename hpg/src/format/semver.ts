/**
 * The small slice of Semantic Versioning 2.0.0 the format needs: parse,
 * validate and compare `MAJOR.MINOR.PATCH[-pre][+build]`.
 *
 * Build metadata (`+…`) is ignored for ordering, as the spec requires. A
 * pre-release sorts below its release (`1.0.0-rc.1 < 1.0.0`); pre-release
 * identifiers compare numerically when both are numeric, else as ASCII.
 */

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export type SemVer = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

export function parseSemver(value: unknown): SemVer | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const m = SEMVER_RE.exec(value);
  if (!m) return null;
  const nums = [m[1], m[2], m[3]].map(Number);
  if (!nums.every(Number.isSafeInteger)) return null;
  return {
    major: nums[0],
    minor: nums[1],
    patch: nums[2],
    prerelease: m[4] ? m[4].split(".") : [],
  };
}

export function isSemver(value: unknown): value is string {
  return parseSemver(value) !== null;
}

/** Negative when a < b, 0 when equal (ignoring build metadata), positive when a > b. */
export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) throw new Error(`invalid semver: ${!x ? a : b}`);
  for (const key of ["major", "minor", "patch"] as const) {
    if (x[key] !== y[key]) return x[key] - y[key];
  }
  if (x.prerelease.length === 0 || y.prerelease.length === 0) {
    return y.prerelease.length - x.prerelease.length;
  }
  const n = Math.max(x.prerelease.length, y.prerelease.length);
  for (let i = 0; i < n; i++) {
    const p = x.prerelease[i];
    const q = y.prerelease[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn) return -1;
    if (qn) return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}
