// @vitest-environment jsdom

/**
 * The shape of `STREAK_EVENT`'s detail, which `GrowthTracker` reads.
 *
 * `streak.test.ts` covers the pure model and the parse/serialise pair; this
 * covers the one thing neither can — what `recordPlay()` actually broadcasts.
 * The `days` field is the reason: `current` alone cannot separate a device's
 * first-ever play from a return after a gap, since both report `current: 1`, and
 * that distinction is the whole retention measure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STREAK_EVENT, STREAK_KEY, type StreakEventDetail } from "./store";
import { dayKey } from "./core";

/** Yesterday and today as the store writes them: local, DST-safe day keys. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayKey(d);
}

/**
 * The store caches its snapshot at module scope, so each case needs a fresh
 * module registry AND a fresh localStorage to start from a known history.
 */
async function freshStore(history: string[] | null) {
  vi.resetModules();
  window.localStorage.clear();
  if (history) {
    window.localStorage.setItem(
      STREAK_KEY,
      JSON.stringify({ days: history, longest: history.length }),
    );
  }
  return import("./store");
}

function captureDetail(): { get: () => StreakEventDetail | null; off: () => void } {
  let seen: StreakEventDetail | null = null;
  const handler = (e: Event) => {
    seen = (e as CustomEvent<StreakEventDetail>).detail;
  };
  window.addEventListener(STREAK_EVENT, handler as EventListener);
  return {
    get: () => seen,
    off: () => window.removeEventListener(STREAK_EVENT, handler as EventListener),
  };
}

let listener: ReturnType<typeof captureDetail>;

beforeEach(() => {
  listener = captureDetail();
});

afterEach(() => {
  listener.off();
  window.localStorage.clear();
});

describe("STREAK_EVENT detail", () => {
  it("reports days: 1 on a device's first ever play", async () => {
    const { recordPlay } = await freshStore(null);
    recordPlay();

    const detail = listener.get();
    expect(detail).not.toBeNull();
    expect(detail?.days).toBe(1);
    expect(detail?.current).toBe(1);
  });

  /**
   * The case that motivated the field. A device returning after a gap breaks its
   * streak, so `current` falls back to 1 — identical to a first-ever play — while
   * `days` keeps counting. Without this, every lapsed player coming back would be
   * indistinguishable from a brand-new device.
   */
  it("separates a return after a gap from a first play", async () => {
    const { recordPlay } = await freshStore([daysAgo(30)]);
    recordPlay();

    const detail = listener.get();
    expect(detail?.current).toBe(1); // streak broken
    expect(detail?.days).toBe(2); // but this device has been here before
  });

  it("counts total days played, not the current run", async () => {
    const { recordPlay } = await freshStore([daysAgo(40), daysAgo(20), daysAgo(1)]);
    recordPlay();

    const detail = listener.get();
    expect(detail?.current).toBe(2); // yesterday + today
    expect(detail?.days).toBe(4);
  });

  it("stays silent on a second play the same day", async () => {
    const { recordPlay } = await freshStore(null);
    recordPlay();
    listener.off();
    listener = captureDetail();

    recordPlay();
    expect(listener.get()).toBeNull();
  });
});
