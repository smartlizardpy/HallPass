import { describe, expect, it } from "vitest";

import { PRIMARY_NAV } from "../components/primary-nav";
import {
  SKELETON_DELAY_MS,
  SLOW_NOTICE_MS,
  needsNetwork,
  tabGateView,
} from "./tab-gate";

/**
 * The two pure halves of the tab gate: which destinations cannot be answered
 * without the network, and what the bar shows while one of them is being
 * fetched. Together they are the whole of what a player sees between tapping
 * You and the page arriving.
 */

describe("needsNetwork", () => {
  it("covers every PRIMARY_NAV destination inside the never-cached subtree", () => {
    // Read off the shared table rather than restated here: these are the actual
    // hrefs the tab bar renders, so the day one moves, this moves with it.
    const gated = PRIMARY_NAV.filter((entry) => needsNetwork(entry.href)).map(
      (entry) => entry.href,
    );
    expect(gated).toEqual(["/play/you/friends", "/play/you"]);
  });

  it("leaves precached destinations alone", () => {
    // Home is precached and opens instantly with no signal at all — covering it
    // would invent a wait that does not exist.
    expect(needsNetwork("/")).toBe(false);
    expect(needsNetwork("/category/arcade")).toBe(false);
    expect(needsNetwork("/game/silence")).toBe(false);
  });

  it("is not fooled by the trailing-slash spelling", () => {
    // `skipTrailingSlashRedirect: true` means `/play/you/` is SERVED, not
    // redirected, so both spellings reach the bar.
    expect(needsNetwork("/play/you/")).toBe(true);
    expect(needsNetwork("/play/you/settings/")).toBe(true);
  });

  it("does not gate a sibling that merely shares the prefix", () => {
    expect(needsNetwork("/play/younger")).toBe(false);
    expect(needsNetwork("/play/yousuf")).toBe(false);
  });
});

describe("tabGateView", () => {
  const idle = { refused: false, online: true, pending: false, waitedMs: 0 };

  it("stays out of the way when nothing is happening", () => {
    expect(tabGateView(idle)).toBe("none");
  });

  it("lets a warm navigation through without flashing a skeleton", () => {
    expect(tabGateView({ ...idle, pending: true, waitedMs: 0 })).toBe("none");
    expect(
      tabGateView({ ...idle, pending: true, waitedMs: SKELETON_DELAY_MS - 1 }),
    ).toBe("none");
  });

  it("shows bones once the wait is long enough to notice", () => {
    expect(
      tabGateView({ ...idle, pending: true, waitedMs: SKELETON_DELAY_MS }),
    ).toBe("skeleton");
  });

  it("adds the notice once bones alone start to read as stuck", () => {
    expect(
      tabGateView({ ...idle, pending: true, waitedMs: SLOW_NOTICE_MS }),
    ).toBe("slow");
    expect(
      tabGateView({ ...idle, pending: true, waitedMs: SLOW_NOTICE_MS * 10 }),
    ).toBe("slow");
  });

  it("gets out of the way the moment the navigation commits", () => {
    // The timers have long since fired, but `pending` is false — the page is
    // here, and the overlay must not linger over it for even one frame.
    expect(
      tabGateView({ ...idle, pending: false, waitedMs: SLOW_NOTICE_MS }),
    ).toBe("none");
  });

  it("answers a refused tap with the card", () => {
    expect(tabGateView({ ...idle, refused: true, online: false })).toBe(
      "offline",
    );
  });

  it("keeps a refusal on screen until the caller drops it", () => {
    // The caller clears the flag when the connection returns or the route
    // changes; nothing else may replace an answer to a deliberate tap.
    expect(
      tabGateView({ refused: true, online: true, pending: true, waitedMs: 0 }),
    ).toBe("offline");
  });

  it("replaces bones with the card when the connection dies mid-navigation", () => {
    // Bones that will never fill in are the same lie as the lit-up tab.
    expect(
      tabGateView({
        refused: false,
        online: false,
        pending: true,
        waitedMs: SKELETON_DELAY_MS,
      }),
    ).toBe("offline");
  });

  it("does not wait for a timer to answer an offline navigation", () => {
    expect(
      tabGateView({
        refused: false,
        online: false,
        pending: true,
        waitedMs: 0,
      }),
    ).toBe("offline");
  });
});

describe("the two thresholds", () => {
  it("are ordered, and neither is zero", () => {
    // Guards the intent rather than the exact numbers: a zero skeleton delay
    // flashes over every fast tap, and a notice at or before the skeleton would
    // shout "slow connection" at a page that is arriving normally.
    expect(SKELETON_DELAY_MS).toBeGreaterThan(0);
    expect(SLOW_NOTICE_MS).toBeGreaterThan(SKELETON_DELAY_MS * 4);
  });
});
