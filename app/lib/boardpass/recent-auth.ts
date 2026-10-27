/**
 * BoardPass — "did this person sign in with Google recently?"
 *
 * Setting, changing or disabling a PIN, and signing out every board, are the
 * account-level actions BoardPass exposes. They need a RECENT full sign-in, not
 * just a live session: a Google session on a school laptop can be 30 days old,
 * and a classmate who finds it open must not be able to set a PIN of their own.
 * `authAt` is stamped on the OAuth pass only (see `app/lib/auth.ts`).
 *
 * Pure so the window can be tested without a session.
 */

import { RECENT_AUTH_SECONDS } from "./config";

/** A token with no `authAt` (minted before this shipped) is NOT recent. */
export function isRecentAuth(authAt: number | undefined, now: number = Date.now()): boolean {
  if (typeof authAt !== "number" || !Number.isFinite(authAt)) return false;
  const age = now - authAt;
  // A timestamp in the future is a clock fault or a forgery; refuse it.
  return age >= 0 && age <= RECENT_AUTH_SECONDS * 1000;
}
