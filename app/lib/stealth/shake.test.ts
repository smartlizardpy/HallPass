import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHAKE_OPTIONS,
  createShakeDetector,
  isShakeTransition,
  type MotionSample,
  type ShakeDetector,
} from "./shake";

const T = DEFAULT_SHAKE_OPTIONS.threshold;

/** A sample at rest — one axis carries gravity, the others sit near zero. */
function rest(t: number): MotionSample {
  return { x: 0, y: 9.8, z: 0, t };
}

/** A sample flung far past the threshold on all three axes. */
function jolt(t: number): MotionSample {
  return { x: 3 * T, y: 3 * T, z: 3 * T, t };
}

/**
 * Drive a back-and-forth shake into the detector and return whether it fired at
 * any point. `swings` counts the alternating rest⇄jolt samples AFTER the priming
 * one — each adjacent pair is a threshold transition.
 */
function shake(d: ShakeDetector, swings: number, start = 0, step = 50): boolean {
  let fired = false;
  let t = start;
  d.push(rest(t)); // prime `last`; no prior sample to compare against
  for (let i = 0; i < swings; i++) {
    t += step;
    fired = d.push(i % 2 === 0 ? jolt(t) : rest(t)) || fired;
  }
  return fired;
}

describe("isShakeTransition", () => {
  it("is true when two axes swing past the threshold", () => {
    const prev = { x: 0, y: 0, z: 0, t: 0 };
    const curr = { x: T + 1, y: T + 1, z: 0, t: 50 };
    expect(isShakeTransition(prev, curr, T)).toBe(true);
  });

  it("is false when only one axis crosses (a tilt or a knock)", () => {
    const prev = { x: 0, y: 0, z: 0, t: 0 };
    const curr = { x: 5 * T, y: 0, z: 0, t: 50 };
    expect(isShakeTransition(prev, curr, T)).toBe(false);
  });

  it("is false when the axes move but stay under the threshold", () => {
    const prev = { x: 0, y: 0, z: 0, t: 0 };
    const curr = { x: T - 1, y: T - 1, z: T - 1, t: 50 };
    expect(isShakeTransition(prev, curr, T)).toBe(false);
  });
});

describe("createShakeDetector", () => {
  it("fires once a sustained shake clears the required hits", () => {
    const d = createShakeDetector();
    // Four transitions (two full back-and-forth cycles) confirm the shake.
    expect(shake(d, 4)).toBe(true);
  });

  it("does NOT fire on a single bump (out-and-back is only two transitions)", () => {
    const d = createShakeDetector();
    // rest → jolt → rest is two transitions, below the four a real shake needs.
    expect(shake(d, 2)).toBe(false);
  });

  it("needs the last hit inside the sliding window", () => {
    const d = createShakeDetector();
    // Three quick transitions, then a fourth long after the window has passed —
    // by which point the first has aged out, so four never coexist.
    d.push(rest(0));
    d.push(jolt(50));
    d.push(rest(100));
    expect(d.push(jolt(150))).toBe(false); // 3 hits in window, not yet enough
    expect(d.push(rest(2000))).toBe(false); // window elapsed → still short
  });

  it("fires exactly once, staying quiet through the cooldown", () => {
    const d = createShakeDetector();
    expect(shake(d, 4)).toBe(true); // confirmed around t=200
    // Keep shaking hard inside the 1500ms cooldown → no repeat trigger.
    expect(d.push(jolt(250))).toBe(false);
    expect(d.push(rest(300))).toBe(false);
    expect(d.push(jolt(1000))).toBe(false);
  });

  it("can fire again after the cooldown elapses", () => {
    const d = createShakeDetector();
    expect(shake(d, 4)).toBe(true); // first shake, cooldown ~until 1700
    expect(shake(d, 4, 2000)).toBe(true); // a fresh shake well past the cooldown
  });

  it("respects a custom threshold and hit count", () => {
    const loose = createShakeDetector({ hitsNeeded: 1 });
    expect(shake(loose, 1)).toBe(true); // one transition is enough here

    const strict = createShakeDetector({ threshold: 100 });
    expect(shake(strict, 8)).toBe(false); // jolts of 45/axis never clear 100
  });

  it("reset() clears history so a half-done shake cannot carry over", () => {
    const d = createShakeDetector();
    d.push(rest(0));
    d.push(jolt(50)); // one hit banked
    d.push(rest(100)); // two hits banked
    d.reset();
    // Only two fresh transitions after reset — the earlier hits are gone, so no fire.
    expect(shake(d, 2, 200)).toBe(false);
  });
});
