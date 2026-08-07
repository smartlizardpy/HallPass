"use client";

/**
 * HallPass — shake-to-panic: the phone/tablet way to raise the panic disguise.
 *
 * The desktop panic KEY is useless on a touch device with no keyboard, so this
 * turns a physical shake of the device into the same "hide the arcade" trigger.
 * It has one genuine advantage over the key: `devicemotion` is a window-level
 * signal that keeps firing even while a game IFRAME holds focus — where the
 * keydown listener cannot reach — so a shake works mid-game too.
 *
 * The module splits, like the rest of the stealth code, into a PURE core (the
 * detector maths, no `window`, unit-tested) and a browser layer (permission
 * handling + the React hook, all `window`-guarded).
 *
 * ── PLATFORM NOTES ──────────────────────────────────────────────────────────
 * iOS 13+ gates the motion sensor behind `DeviceMotionEvent.requestPermission()`,
 * which throws unless it is called from within a user gesture. Every other
 * platform streams motion with no prompt. {@link requestMotionPermission} papers
 * over the difference; {@link useShakeToPanic} re-acquires on the first tap after
 * a reload so an enabled shake survives a cold load on iOS without a re-toggle.
 *
 * ── DELIBERATELY ONE-DIRECTIONAL ────────────────────────────────────────────
 * A shake only RAISES the panic screen; it never dismisses it. Toggling on
 * motion would mean a phone jostled on a desk could REVEAL the arcade at the
 * worst moment. Dismissal stays the deliberate act it already is — the panic
 * key, Escape, or the hidden corner tap-target in `PanicScreen`.
 */

import { useEffect } from "react";

/* -------------------------------------------------------------------------- *
 * Pure detector core — no `window`, fully unit-testable.
 * -------------------------------------------------------------------------- */

/** One accelerometer reading. `t` is a millisecond timestamp (monotonic). */
export type MotionSample = { x: number; y: number; z: number; t: number };

export type ShakeOptions = {
  /** Per-axis acceleration delta (m/s²) between samples that counts as violent. */
  threshold: number;
  /** How many qualifying transitions inside `windowMs` confirm a real shake. */
  hitsNeeded: number;
  /** The sliding window the hits must fall within. */
  windowMs: number;
  /** Quiet period after a confirmed shake, so one shake fires exactly once. */
  cooldownMs: number;
};

/**
 * Tuned for `accelerationIncludingGravity` (the widely-supported field, values
 * around ±9.8 at rest). A two-axis threshold of 15 clears tilts and single taps.
 *
 * `hitsNeeded: 4` is the load-bearing choice: one sharp bump registers TWO
 * transitions on its own (the swing out and the swing back), so requiring four —
 * roughly two full back-and-forth cycles inside 1.5s — is what separates a
 * deliberate shake from the phone being knocked or set down. The cooldown then
 * collapses the burst a real shake produces down to a single trigger.
 */
export const DEFAULT_SHAKE_OPTIONS: ShakeOptions = {
  threshold: 15,
  hitsNeeded: 4,
  windowMs: 1500,
  cooldownMs: 1500,
};

/**
 * Whether the jump between two samples reads as a shake rather than a tilt or a
 * tap: at least TWO of the three axes must swing past the threshold. A single
 * axis crossing is just a fast rotation or a knock; two moving together is the
 * signature of a genuine back-and-forth shake. Pure.
 */
export function isShakeTransition(
  prev: MotionSample,
  curr: MotionSample,
  threshold: number,
): boolean {
  const dx = Math.abs(curr.x - prev.x);
  const dy = Math.abs(curr.y - prev.y);
  const dz = Math.abs(curr.z - prev.z);
  return (
    (dx > threshold && dy > threshold) ||
    (dx > threshold && dz > threshold) ||
    (dy > threshold && dz > threshold)
  );
}

export type ShakeDetector = {
  /** Feed a reading; returns true exactly once when a shake is confirmed. */
  push(sample: MotionSample): boolean;
  /** Forget all history (used when the listener detaches). */
  reset(): void;
};

/**
 * A stateful shake detector built from the pure {@link isShakeTransition} test.
 * All time comes from the samples' own `t`, so the detector is deterministic and
 * testable without a clock. Not tied to `window`.
 */
export function createShakeDetector(
  options: Partial<ShakeOptions> = {},
): ShakeDetector {
  const o = { ...DEFAULT_SHAKE_OPTIONS, ...options };
  let last: MotionSample | null = null;
  let hits: number[] = [];
  let cooldownUntil = 0;

  return {
    push(sample: MotionSample): boolean {
      const prev = last;
      last = sample;
      if (!prev) return false;
      // Inside the quiet period after a confirmed shake: keep tracking the latest
      // sample (so the next comparison is fresh) but never fire.
      if (sample.t < cooldownUntil) return false;
      if (!isShakeTransition(prev, sample, o.threshold)) return false;

      hits.push(sample.t);
      hits = hits.filter((t) => sample.t - t <= o.windowMs);
      if (hits.length >= o.hitsNeeded) {
        hits = [];
        cooldownUntil = sample.t + o.cooldownMs;
        return true;
      }
      return false;
    },
    reset(): void {
      last = null;
      hits = [];
      cooldownUntil = 0;
    },
  };
}

/* -------------------------------------------------------------------------- *
 * Browser layer — motion capability + permission (all `window`-guarded).
 * -------------------------------------------------------------------------- */

type MotionPermission = "granted" | "denied" | "default";

/** The subset of the `DeviceMotionEvent` constructor we touch (iOS extension). */
interface DeviceMotionEventCtor {
  requestPermission?: () => Promise<MotionPermission>;
}

function motionEventCtor(): DeviceMotionEventCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { DeviceMotionEvent?: DeviceMotionEventCtor })
    .DeviceMotionEvent;
  return ctor ?? null;
}

/**
 * Whether it makes sense to OFFER shake-to-panic here: the sensor API exists and
 * this is a touch device. Desktops define `DeviceMotionEvent` but never fire it,
 * so a coarse pointer / touch points is the honest "phone or tablet" signal.
 */
export function deviceHasMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (!motionEventCtor()) return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  return coarse || touch;
}

/** Whether reading motion requires the iOS permission prompt. */
export function motionPermissionNeeded(): boolean {
  const ctor = motionEventCtor();
  return typeof ctor?.requestPermission === "function";
}

/**
 * Cached grant. iOS remembers the decision per origin, but the listener still
 * needs to know whether a prompt is owed on this page load; caching a success
 * keeps a later attach from prompting twice in one session.
 */
let motionGranted = false;

/**
 * Ask for motion access. Resolves true when motion can be read — immediately on
 * platforms with no prompt, or after the user accepts the iOS prompt. MUST be
 * called from within a user gesture on iOS, or the prompt rejects.
 */
export async function requestMotionPermission(): Promise<boolean> {
  const ctor = motionEventCtor();
  if (!ctor || typeof ctor.requestPermission !== "function") {
    // No gate on this platform — motion is already readable.
    motionGranted = true;
    return true;
  }
  try {
    const result = await ctor.requestPermission();
    motionGranted = result === "granted";
    return motionGranted;
  } catch {
    // Called outside a gesture, or the user dismissed it — treat as not granted.
    return false;
  }
}

/* -------------------------------------------------------------------------- *
 * React hook.
 * -------------------------------------------------------------------------- */

/**
 * Wire a device shake to `onShake` while `enabled`. No-op on the server, on a
 * browser with no motion API, or when `enabled` is false. `onShake` must be
 * stable (wrap it in `useCallback`) — it is an effect dependency.
 *
 * On a platform that gates motion (iOS), if the grant has not been captured yet
 * this load, the listener is armed on the FIRST user gesture — so an enabled
 * shake keeps working after a reload without the player re-opening settings.
 */
export function useShakeToPanic(enabled: boolean, onShake: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || !motionEventCtor()) return;

    const detector = createShakeDetector();
    let detached = false;
    let motionAttached = false;

    const onMotion = (event: DeviceMotionEvent) => {
      const a = event.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      if (detector.push({ x: a.x, y: a.y, z: a.z, t: event.timeStamp })) {
        onShake();
      }
    };

    const attachMotion = () => {
      if (detached || motionAttached) return;
      motionAttached = true;
      window.addEventListener("devicemotion", onMotion);
    };

    // Re-acquire permission on the first tap when a prompt is owed; otherwise the
    // sensor is already readable and we can listen straight away.
    let onFirstGesture: (() => void) | null = null;
    if (motionPermissionNeeded() && !motionGranted) {
      onFirstGesture = () => {
        void requestMotionPermission().then((ok) => {
          if (ok) attachMotion();
        });
      };
      window.addEventListener("pointerdown", onFirstGesture, { once: true });
    } else {
      attachMotion();
    }

    return () => {
      detached = true;
      window.removeEventListener("devicemotion", onMotion);
      if (onFirstGesture) window.removeEventListener("pointerdown", onFirstGesture);
    };
  }, [enabled, onShake]);
}
