"use client";

/**
 * HallPass — is this device on a network at all, as a subscription.
 *
 * WHAT `navigator.onLine` IS WORTH, honestly. It answers "does this machine have
 * a network interface with a route", not "can it reach HallPass". A phone on the
 * school wifi behind a captive portal reports `true` and cannot load a thing. So
 * a `false` here is RELIABLE (there is definitely no way out) while a `true` is
 * only a hint — which is exactly how `tabGateView` uses it: `false` answers the
 * tap immediately, `true` lets the navigation start and leaves the rest to the
 * clock, because a stalled navigation is the only evidence of the cases this
 * property cannot see.
 *
 * WHY `useSyncExternalStore` RATHER THAN `useState` + LISTENERS. The same shape
 * as `useForceDesktop` in `use-device-platform.ts`, for the same two reasons: the
 * value lives outside React (on `navigator`), and every consumer must turn over
 * on the same event rather than each keeping its own copy that can drift. It also
 * makes the SERVER answer explicit rather than accidental.
 *
 * THE SERVER SNAPSHOT IS ALWAYS `true`. The prerendered HTML is shared by every
 * visitor and sits in the service-worker precache, so it must not contain one
 * device's connectivity; and the optimistic answer is the safe one — a first
 * paint that assumes online renders the ordinary UI, and the real value arrives
 * on the render after hydration. Assuming offline would flash a failure state at
 * everybody. Same second-paint rule the device hooks follow.
 *
 * NOT ADOPTED BY `PWA.tsx`, which tracks the same two events for its offline
 * pill. That component's state is deliberately production-only (it lives inside
 * the effect that registers the service worker, behind a `NODE_ENV` guard), so
 * folding it in here would either switch the pill on in development or drag that
 * guard into a hook that has no business with it.
 */

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * `!== false` rather than a bare read: a browser without the property (or a test
 * DOM that never defines it) is treated as online, which is the same optimistic
 * direction as the server snapshot. Only an explicit `false` is trusted.
 */
function getSnapshot(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Whether the device currently has a network route. See the module docblock. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
