/**
 * The desktop menus' way out of a stalled router: after HARD_NAVIGATION_MS, still
 * on the same page, online and visible, load the destination as a document.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStallEscape, type StallEscapeEnv } from "./stall-escape";
import { HARD_NAVIGATION_MS } from "./tab-gate";

function setup(over: Partial<StallEscapeEnv> = {}) {
  const state = { here: "/", online: true, visible: true };
  const assign = vi.fn();
  const env: StallEscapeEnv = {
    here: () => state.here,
    online: () => state.online,
    visible: () => state.visible,
    assign,
    ...over,
  };
  return { state, assign, escape: createStallEscape(env) };
}

describe("stall escape", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads the destination itself when the router never commits", () => {
    const { escape, assign } = setup();
    escape.watch("/play/you");
    vi.advanceTimersByTime(HARD_NAVIGATION_MS - 1);
    expect(assign).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(assign).toHaveBeenCalledExactlyOnceWith("/play/you");
  });

  it("does nothing when the navigation committed", () => {
    const { escape, assign, state } = setup();
    escape.watch("/play/you");
    state.here = "/play/you";
    vi.advanceTimersByTime(HARD_NAVIGATION_MS * 2);
    expect(assign).not.toHaveBeenCalled();
  });

  it("counts a query-only change as a commit", () => {
    const { escape, assign, state } = setup();
    escape.watch("/?q=snake");
    state.here = "/?q=snake";
    vi.advanceTimersByTime(HARD_NAVIGATION_MS);
    expect(assign).not.toHaveBeenCalled();
  });

  it("does not load while offline: the offline card is the right answer", () => {
    const { escape, assign, state } = setup();
    escape.watch("/play/you");
    state.online = false;
    vi.advanceTimersByTime(HARD_NAVIGATION_MS);
    expect(assign).not.toHaveBeenCalled();
  });

  it("leaves a hidden tab alone", () => {
    const { escape, assign, state } = setup();
    escape.watch("/play/you");
    state.visible = false;
    vi.advanceTimersByTime(HARD_NAVIGATION_MS);
    expect(assign).not.toHaveBeenCalled();
  });

  it("only the last tap matters", () => {
    const { escape, assign } = setup();
    escape.watch("/play/you");
    vi.advanceTimersByTime(HARD_NAVIGATION_MS - 100);
    escape.watch("/play/you/friends");
    vi.advanceTimersByTime(200); // past the first deadline: it must have been replaced
    expect(assign).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HARD_NAVIGATION_MS);
    expect(assign).toHaveBeenCalledExactlyOnceWith("/play/you/friends");
  });

  it("cancel stops the clock", () => {
    const { escape, assign } = setup();
    escape.watch("/play/you");
    escape.cancel();
    vi.advanceTimersByTime(HARD_NAVIGATION_MS * 2);
    expect(assign).not.toHaveBeenCalled();
  });

  it("escapes from any page, not just the home page", () => {
    const { escape, assign, state } = setup();
    state.here = "/category/arcade";
    escape.watch("/");
    vi.advanceTimersByTime(HARD_NAVIGATION_MS);
    expect(assign).toHaveBeenCalledExactlyOnceWith("/");
  });
});
