/**
 * HallPass — the way out of a stalled client router, for the desktop menus.
 *
 * The bottom tab bar has had this rule since `48de092`: if a tap is still pending
 * after `HARD_NAVIGATION_MS`, online, stop trusting the client router and load
 * the page itself (see `tab-gate.ts`). The menus an iPad or a laptop uses — the
 * top navigation, the side rail, the account dropdown and the header search — had
 * no such escape. A router that accepts a tap and never commits it (an installed
 * app or an old tab a deploy behind the server, a hung RSC fetch) left every one
 * of those links doing nothing, with no way out short of closing the tab.
 *
 * ── WHY IT ARMS FROM `onNavigate`, NOT A GLOBAL CLICK LISTENER ──────────────
 * A document-level listener cannot tell a link that navigates from a link that
 * opens a player or a modal in place: both are `preventDefault`ed, both have an
 * `href`, and a timer that hard-loaded the second kind would yank a player out of
 * the game they had just opened. `<Link onNavigate>` fires only for a real
 * client-side navigation (never for ⌘/Ctrl-click, `target`, or a non-local
 * href — `link.md`, "onNavigate"), so arming from it is exactly "the router took
 * this tap".
 *
 * ── WHY NOT `useLinkStatus` ─────────────────────────────────────────────────
 * Its docs say the pending state is skipped when the route was prefetched, which
 * is the common case for these links. The tab bar records the journey itself for
 * the same reason; this does too.
 *
 * ── WHAT COUNTS AS "COMMITTED" ──────────────────────────────────────────────
 * The location is no longer where the tap started. Checked against the real
 * `location` (path AND query) when the timer fires, so a navigation that changed
 * only the query string, as search does, counts. A hidden tab is left alone: the
 * player has gone, and a page load nobody sees is just a cost.
 *
 * DOM-free apart from the injected environment, so the rule is unit-tested rather
 * than reasoned about inside a component. The React wrapper is `use-stall-escape`.
 */

import { HARD_NAVIGATION_MS, shouldHardNavigate } from "./tab-gate";

/** What the watcher needs from the page, injected so a test can fake all of it. */
export type StallEscapeEnv = {
  /** Where the page is now: `pathname + search`. */
  here(): string;
  online(): boolean;
  visible(): boolean;
  /** A plain document load. Does not go through the client router. */
  assign(href: string): void;
};

export type StallEscape = {
  /** The router has just taken a tap on `href`; start the clock. */
  watch(href: string): void;
  /** The journey ended some other way (a commit, an unmount); stop the clock. */
  cancel(): void;
};

export function createStallEscape(env: StallEscapeEnv): StallEscape {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  return {
    cancel,
    watch(href) {
      // Only the LAST tap matters: a second tap replaces the first, as the router
      // itself does ("only the last link's pending state is shown").
      cancel();
      const from = env.here();
      timer = setTimeout(() => {
        timer = undefined;
        if (env.here() !== from) return; // it committed
        if (!env.visible()) return; // the player left
        if (!shouldHardNavigate({ online: env.online(), waitedMs: HARD_NAVIGATION_MS })) return;
        env.assign(href);
      }, HARD_NAVIGATION_MS);
    },
  };
}
