/**
 * HallPass — FIRST-TOUCH `ref` capture.
 *
 * Last-touch needs no code: `ref` is registered through PostHog's
 * `custom_campaign_params` option in `instrumentation-client.ts`, so it rides the
 * same `update_campaign_params()` pipeline as `utm_*` and lands as a super
 * property on every event. This module exists for the OTHER half — the channel
 * somebody arrived through the very first time, which is the number that actually
 * answers "where do our players come from".
 *
 * TWO THINGS ABOUT THE INSTALLED SDK SHAPE THIS, both read out of
 * `posthog-js` 1.395.0 rather than assumed:
 *
 * 1. `getSetOnceProps()` enumerates only the five `utm_*` names in its fallback
 *    branch. A custom campaign param is therefore NOT guaranteed to reach the
 *    initial-touch properties the SDK maintains, so first-touch `ref` is a gap we
 *    have to fill ourselves. This is not shadowing a built-in — the built-in
 *    provably does not cover it.
 *
 * 2. `person_profiles` DEFAULTS TO `identified_only`. That is the decisive one.
 *    The obvious implementation of first-touch is a `$set_once` person property,
 *    and on this site it would silently record nothing for most visitors:
 *    Google Workspace for Education blocks under-18 accounts from unapproved
 *    third-party apps (README, `challenge-sharing-design.md`), so a large share
 *    of our players CANNOT sign in and never get a person profile at all. An
 *    attribution feature that only works for the minority who can authenticate
 *    would answer the question backwards.
 *
 * So first touch is a SUPER PROPERTY via `register_once`, not a person property.
 * Super properties persist in localStorage+cookie, attach to every event, and are
 * completely indifferent to whether anyone ever identifies. `register_once` is
 * genuinely set-once: a later visit through a different channel does not overwrite
 * it, which is exactly the semantics first-touch means.
 *
 * DEVICE-SCOPED, AND HONESTLY SO. A shared school Chromebook is one browser
 * profile for a whole class, so this records the channel that first brought THE
 * DEVICE, not the person. Every panel that reads it says "devices" for that
 * reason — see `marketing-design.md` §2.
 */

import posthog from "posthog-js";
import { REF_PARAM, bucketRef, normalizeRef } from "./channels";

/** Super property: the raw `ref` this device first arrived with. */
export const FIRST_REF_PROPERTY = "hp_initial_ref";

/**
 * Super property: that same first `ref` folded into a known channel or
 * `unknown`. Stored ALONGSIDE the raw value rather than instead of it, so the
 * dashboard can group by a clean axis while a typo in circulation stays visible
 * in the raw column and can be traced back to whichever link carries it.
 */
export const FIRST_REF_CHANNEL_PROPERTY = "hp_initial_ref_channel";

/** Read the `ref` off a query string. Exported for testing; no browser needed. */
export function readRef(search: string): string | null {
  try {
    return normalizeRef(new URLSearchParams(search).get(REF_PARAM));
  } catch {
    // A malformed query string is not worth breaking analytics init over.
    return null;
  }
}

/**
 * Record the first-touch channel, once per device.
 *
 * A no-op when there is no `ref` on the URL — including for every visitor who
 * arrives organically, which is most of them. It deliberately does NOT write an
 * "untagged" marker in that case: the absence of the property already means
 * untagged, and writing one on the first organic visit would burn the set-once
 * slot before the tagged visit that mattered ever happened.
 *
 * Safe to call unconditionally. It checks for a browser and for a live PostHog,
 * so a missing analytics token (`instrumentation-client.ts` guards on it) or a
 * server render leaves it inert rather than throwing during startup.
 */
export function recordFirstTouchRef(): void {
  if (typeof window === "undefined") return;

  const ref = readRef(window.location.search);
  if (ref === null) return;

  try {
    posthog.register_once({
      [FIRST_REF_PROPERTY]: ref,
      [FIRST_REF_CHANNEL_PROPERTY]: bucketRef(ref),
    });
  } catch {
    /* Analytics must never take the page down. */
  }
}
