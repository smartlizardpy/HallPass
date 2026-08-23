/**
 * HallPass mobile — what the bottom tab bar SHOWS while a tap is being answered.
 *
 * ── WHY A CLIENT-SIDE GATE EXISTS AT ALL, given the two server-side answers ──
 *
 * Tapping You on a bad connection used to light the tab purple and do nothing
 * visible for as long as the network took. Two things were already built for
 * that and NEITHER can fill this particular gap:
 *
 *   * `/offline/you` — the card `public/sw.js` serves when a navigation FAILS.
 *     It needs the navigation to fail first, and it needs the service worker
 *     that knows about it. An installed PWA keeps whichever service worker it
 *     last installed until it is relaunched with a network, so on a phone the
 *     card can be a deploy behind the browser tab that works fine.
 *   * The `<Suspense>` boundary in `app/play/you/layout.tsx` — bones streamed
 *     from the SERVER. They arrive at the speed of the first byte, so on the
 *     connection this is all for, they are late by exactly the amount that
 *     feels broken.
 *
 * Everything between the tap and the first byte belongs to the client, and this
 * module is the rule for it: an instant skeleton, a plain answer if the device
 * is knowingly offline, and an explanation if the wait becomes unreasonable. The
 * server-side halves keep their jobs — this covers the part neither can see.
 *
 * PURE AND DOM-FREE, like `playsOn` in `use-device-platform`, so the precedence
 * below is unit-tested rather than reasoned about inside a component.
 */

import { isUnder, normalizePath } from "../components/primary-nav";

/**
 * How long a tap may go unanswered before the skeleton appears.
 *
 * NOT ZERO. A warm navigation commits in a few dozen milliseconds and covering
 * it with a full-screen skeleton would replace a smooth transition with a flash
 * — the same "only show the hint if the navigation actually takes time" point
 * the Next docs make about `useLinkStatus` (`04-functions/use-link-status.md`,
 * "Gracefully handling fast navigation"), where they suggest ~100ms for an
 * inline dot. 150ms is below what reads as a delay and above what reads as a
 * flicker.
 */
export const SKELETON_DELAY_MS = 150;

/**
 * How long the skeleton may sit there before it owes the player a sentence.
 *
 * Bones alone say "loading". After several seconds they start saying "stuck",
 * and a player who cannot tell the difference between a slow app and a broken
 * one taps again, or leaves. This is the point at which the overlay stops
 * implying and says it out loud.
 */
export const SLOW_NOTICE_MS = 5000;

/**
 * What the bar is showing over the page.
 *
 *   `none`     — nothing; the tap is being handled normally.
 *   `skeleton` — the destination's bones, while the navigation completes.
 *   `slow`     — the bones PLUS a "still trying" notice. Not a replacement:
 *                the page may still arrive, so the bones stay.
 *   `offline`  — the offline card; the device has no network route.
 */
export type TabGateView = "none" | "skeleton" | "slow" | "offline";

/**
 * Does reaching `href` require the network RIGHT NOW — i.e. is it one of the
 * destinations the service worker deliberately never stores?
 *
 * Derived from the href rather than a hand-written list of gated tabs, so this
 * and `isPrivatePath` in `public/sw.js` cannot disagree about which pages have
 * no offline copy: both are "the `/play/you` subtree", stated as a prefix. A
 * fourth tab pointing into that subtree is gated the day it is added, and a tab
 * pointing anywhere else (Home is precached, and opens instantly offline) is
 * left alone.
 *
 * Callers may pass a raw `href` — normalisation happens here, because `/play/you/`
 * is a LIVE url on this site (`skipTrailingSlashRedirect: true`) and the slashed
 * spelling has exactly the same problem as the bare one.
 */
export function needsNetwork(href: string): boolean {
  return isUnder(normalizePath(href), "/play/you");
}

/** Everything the gate knows at render time. */
export type TabGateInput = {
  /** A tap this bar answered itself instead of navigating. */
  refused: boolean;
  /** `navigator.onLine` — see `use-online.ts` for what it is and is not worth. */
  online: boolean;
  /** A gated tab's `useLinkStatus().pending`. */
  pending: boolean;
  /** How long that pending state has lasted. */
  waitedMs: number;
};

/**
 * The gate's whole decision, as one table.
 *
 * PRECEDENCE IS THE POINT, and it is why this is a function rather than three
 * booleans read straight off the component:
 *
 *   * A REFUSED TAP OUTRANKS EVERYTHING. The card is a direct answer to
 *     something the player just did; nothing may quietly replace it, and it
 *     stays until it is dismissed.
 *   * OFFLINE OUTRANKS WAITING. A connection that dies mid-navigation turns the
 *     skeleton into the same lie as the lit-up tab — bones that will never fill
 *     in. The card replaces them and says why.
 *   * THE CLOCK IS LAST, and only while something is actually pending. Once the
 *     navigation commits, `pending` goes false and the overlay must get out of
 *     the way instantly, however long it had been up.
 */
export function tabGateView({
  refused,
  online,
  pending,
  waitedMs,
}: TabGateInput): TabGateView {
  if (refused) return "offline";
  if (!pending) return "none";
  if (!online) return "offline";
  if (waitedMs >= SLOW_NOTICE_MS) return "slow";
  return waitedMs >= SKELETON_DELAY_MS ? "skeleton" : "none";
}
