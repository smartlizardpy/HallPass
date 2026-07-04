// @vitest-environment jsdom
/**
 * The popup sign-in helpers. Everything here is guarded and must never throw, so
 * the tests drive the happy path AND the ignored-signal / cancel paths.
 *
 * `subscribeAuthSignals` opens a real `BroadcastChannel` when one exists; we stub
 * it to `undefined` so each test only exercises the storage + postMessage
 * transports (and nothing survives the test on the event loop). `watchPopup` is
 * timer-driven, so those cases run under fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeAuthSignals, watchPopup } from "./auth-flow";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("subscribeAuthSignals", () => {
  beforeEach(() => {
    // Skip the BroadcastChannel transport so no channel outlives the test.
    vi.stubGlobal("BroadcastChannel", undefined);
  });

  it("fires the callback on a storage event for the pinned key only", () => {
    const cb = vi.fn();
    const unsubscribe = subscribeAuthSignals(cb);

    window.dispatchEvent(new window.StorageEvent("storage", { key: "hallpass:auth" }));
    expect(cb).toHaveBeenCalledTimes(1);

    // An unrelated key is ignored.
    window.dispatchEvent(new window.StorageEvent("storage", { key: "something-else" }));
    expect(cb).toHaveBeenCalledTimes(1);

    // After unsubscribing the listener is gone.
    unsubscribe();
    window.dispatchEvent(new window.StorageEvent("storage", { key: "hallpass:auth" }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("accepts a same-origin pinned message but ignores wrong origin / wrong type", () => {
    const cb = vi.fn();
    const unsubscribe = subscribeAuthSignals(cb);

    // Right shape, wrong origin.
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: { type: "hallpass:auth" },
        origin: "https://evil.example",
      }),
    );
    expect(cb).not.toHaveBeenCalled();

    // Right origin, wrong type.
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: { type: "not-ours" },
        origin: window.location.origin,
      }),
    );
    expect(cb).not.toHaveBeenCalled();

    // Right origin AND right type.
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: { type: "hallpass:auth" },
        origin: window.location.origin,
      }),
    );
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});

describe("watchPopup", () => {
  it("invokes onMaybeDone exactly once when the popup closes, then stops", () => {
    vi.useFakeTimers();
    const popup = { closed: false } as unknown as Window & { closed: boolean };
    const onMaybeDone = vi.fn();

    watchPopup(popup, onMaybeDone);

    // Still open after a poll tick.
    vi.advanceTimersByTime(500);
    expect(onMaybeDone).not.toHaveBeenCalled();

    // Closing is noticed on the next tick — exactly once.
    popup.closed = true;
    vi.advanceTimersByTime(500);
    expect(onMaybeDone).toHaveBeenCalledTimes(1);

    // Subsequent ticks do not fire it again (the watcher stopped itself).
    vi.advanceTimersByTime(5000);
    expect(onMaybeDone).toHaveBeenCalledTimes(1);
  });

  it("stops polling after the returned cancel is called", () => {
    vi.useFakeTimers();
    const popup = { closed: false } as unknown as Window & { closed: boolean };
    const onMaybeDone = vi.fn();

    const cancel = watchPopup(popup, onMaybeDone);
    cancel();

    // Even after the popup closes, the cancelled watcher never fires.
    popup.closed = true;
    vi.advanceTimersByTime(5000);
    expect(onMaybeDone).not.toHaveBeenCalled();

    // Cancel is idempotent — a second call is a safe no-op.
    expect(() => cancel()).not.toThrow();
  });

  it("returns a safe no-op cancel for a null popup", () => {
    const cancel = watchPopup(null, () => {});
    expect(() => cancel()).not.toThrow();
  });
});
