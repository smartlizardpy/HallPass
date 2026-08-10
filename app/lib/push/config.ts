/**
 * HallPass — Web Push tunables and configuration state.
 *
 * Mirrors `challenges/config.ts` and `social/config.ts`: pure of database and
 * `server-only`, so the store, the routes and the tests all read one source.
 *
 * ── GRACEFUL WHEN UNCONFIGURED ─────────────────────────────────────────────
 * Everything here tolerates absent VAPID keys, deliberately, so the whole
 * feature can ship dark and light up when the env vars land. That is the same
 * contract `db.ts` honours for `DATABASE_URL`: never crash at import, report
 * unavailability honestly, and fail only at the point of actual use. A deploy
 * without keys must not 500 a single route.
 *
 * ── WHY THE PUBLIC KEY IS NOT `NEXT_PUBLIC_` ───────────────────────────────
 * It is a public value and could be inlined — but `NEXT_PUBLIC_*` is baked in at
 * BUILD time, and this repo has already been bitten by exactly that: the README
 * and `scripts/check-build-env.mjs` exist because a missing
 * `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` at build time silently shipped a build
 * that captured zero analytics. Serving the key from the subscribe endpoint at
 * REQUEST time means adding the env var takes effect on the next request rather
 * than the next build, and a missing one is visible as "push unavailable"
 * instead of a build that quietly never notifies anybody.
 */

/**
 * The VAPID keypair and contact subject.
 *
 * Read lazily through a function rather than captured at module scope, so a
 * value set after import (and, more practically, a test that sets one) is seen.
 */
export function vapidConfig(): {
  publicKey: string;
  privateKey: string;
  subject: string;
} {
  return {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
    privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
    // A `mailto:` the push service can contact about misbehaviour. Required by
    // the VAPID spec; the fallback keeps an unconfigured deploy from throwing on
    // a value nobody has set yet, and `isPushConfigured` is what actually gates.
    subject: process.env.VAPID_SUBJECT ?? "mailto:smartlizardpy@duck.com",
  };
}

/** Whether push can actually be sent. False on a deploy with no keys set. */
export function isPushConfigured(): boolean {
  const { publicKey, privateKey } = vapidConfig();
  return publicKey.length > 0 && privateKey.length > 0;
}

/**
 * Devices one player may have subscribed at once.
 *
 * A cap rather than a target, and generous: a phone, a home laptop, a school
 * Chromebook and a tablet is four before anybody is doing anything unusual.
 * Exceeding it evicts the LEAST RECENTLY SEEN, never the oldest — a phone used
 * daily for two years must outlive a Chromebook borrowed once last term.
 */
export const PUSH_DEVICE_CAP = 10;

/**
 * How push notifications are collapsed on the device.
 *
 * All challenge notifications share one tag, so a player who is challenged four
 * times while their phone is in a bag sees ONE notification rather than four.
 * The inbox is the place to read the detail; the notification's only job is to
 * say something is waiting.
 */
export const CHALLENGE_NOTIFICATION_TAG = "hallpass-challenge";
