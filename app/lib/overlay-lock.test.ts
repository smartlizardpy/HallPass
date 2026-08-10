// @vitest-environment jsdom
/**
 * Tests for the ref-counted overlay lock.
 *
 * The behaviours worth pinning down are the ones the old hand-rolled locks got
 * wrong, and each of them shipped at least once:
 *   1. RESTORING, not clearing. `PlayerOverlay` used to set `overflow = ""` on
 *      close, which unfroze the page for whatever modal was still open behind it.
 *   2. NESTING. Two overlaps must not free each other's lock — in either release
 *      order, because a React commit does not promise to unmount them in the
 *      order they mounted.
 *   3. A DOUBLE RELEASE. An effect cleanup that fires twice must release once; a
 *      stray decrement would hand the page back while a sibling still holds it.
 *   4. THE QUERY seeing BOTH kinds of lock. `isOverlayOpen()` is the guard
 *      `FeaturePromo` consults before interrupting somebody, and half the
 *      overlays on the site still lock by writing the string directly.
 *
 * The module keeps MODULE-SCOPE state (the count and the recorded value), so
 * every test gets a fresh copy via `vi.resetModules()` + a dynamic import — the
 * same isolation trick as `personalization.store.test.ts`. jsdom is needed only
 * for a real `document.body.style`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type LockModule = typeof import("./overlay-lock");

/** A fresh module instance, with the page starting from `overflow`. */
async function freshLock(overflow = ""): Promise<LockModule> {
  vi.resetModules();
  document.body.style.overflow = overflow;
  return import("./overlay-lock");
}

beforeEach(() => {
  document.body.style.overflow = "";
});

describe("acquireOverlayLock", () => {
  it("clamps the body while a single overlay holds it", async () => {
    const { acquireOverlayLock, overlayLockCount } = await freshLock();
    const release = acquireOverlayLock();
    expect(document.body.style.overflow).toBe("hidden");
    expect(overlayLockCount()).toBe(1);
    release();
    expect(overlayLockCount()).toBe(0);
  });

  it("restores an unset overflow to unset", async () => {
    const { acquireOverlayLock } = await freshLock("");
    acquireOverlayLock()();
    expect(document.body.style.overflow).toBe("");
  });

  it("gives the page back the value it actually had", async () => {
    // The page — not the lock — decides what "unlocked" looks like. A page that
    // was already `scroll` must not come back as `""`.
    const { acquireOverlayLock } = await freshLock("scroll");
    acquireOverlayLock()();
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("hands a lock taken over someone else's back to them", async () => {
    // The straggler case: `Sidebar`'s drawer locked the old way, then the player
    // opened over it. Closing the player must leave the drawer frozen.
    const { acquireOverlayLock } = await freshLock("hidden");
    acquireOverlayLock()();
    expect(document.body.style.overflow).toBe("hidden");
  });
});

describe("nested locks", () => {
  it("stays locked until the last holder releases", async () => {
    const { acquireOverlayLock, overlayLockCount } = await freshLock();
    const outer = acquireOverlayLock();
    const inner = acquireOverlayLock();
    expect(overlayLockCount()).toBe(2);

    inner();
    expect(document.body.style.overflow).toBe("hidden");
    expect(overlayLockCount()).toBe(1);

    outer();
    expect(document.body.style.overflow).toBe("");
    expect(overlayLockCount()).toBe(0);
  });

  it("does not care which one releases first", async () => {
    // React gives no guarantee that overlapping overlays unmount in the order
    // they mounted, so the outer lock releasing first must be just as correct.
    const { acquireOverlayLock } = await freshLock();
    const outer = acquireOverlayLock();
    const inner = acquireOverlayLock();

    outer();
    expect(document.body.style.overflow).toBe("hidden");

    inner();
    expect(document.body.style.overflow).toBe("");
  });

  it("records the page's value once, at the first acquire", async () => {
    // The second acquire observes `hidden` — the FIRST lock's own doing. Recording
    // that would freeze the page permanently.
    const { acquireOverlayLock } = await freshLock("scroll");
    const outer = acquireOverlayLock();
    const inner = acquireOverlayLock();
    inner();
    outer();
    expect(document.body.style.overflow).toBe("scroll");
  });
});

describe("releasing twice", () => {
  it("is harmless on its own", async () => {
    const { acquireOverlayLock, overlayLockCount } = await freshLock();
    const release = acquireOverlayLock();
    release();
    release();
    expect(overlayLockCount()).toBe(0);
    expect(document.body.style.overflow).toBe("");
  });

  it("cannot free another overlay's lock", async () => {
    // The reason the release is idempotent rather than just "safe": a stray second
    // decrement would drop the count below the number of overlays still up, and
    // the page would start scrolling behind whichever one is still open.
    const { acquireOverlayLock, overlayLockCount } = await freshLock();
    const first = acquireOverlayLock();
    acquireOverlayLock();

    first();
    first();
    expect(overlayLockCount()).toBe(1);
    expect(document.body.style.overflow).toBe("hidden");
  });
});

describe("isOverlayOpen", () => {
  it("is false on a page nobody has locked", async () => {
    const { isOverlayOpen } = await freshLock();
    expect(isOverlayOpen()).toBe(false);
  });

  it("sees a counted lock", async () => {
    const { acquireOverlayLock, isOverlayOpen } = await freshLock();
    const release = acquireOverlayLock();
    expect(isOverlayOpen()).toBe(true);
    release();
    expect(isOverlayOpen()).toBe(false);
  });

  it("sees an overlay that still locks by writing the string", async () => {
    // Load-bearing: `Sidebar`, `PanicScreen` and the beta tutorial have not
    // migrated, and a promo that stopped noticing them would be the same bug in a
    // new place.
    const { isOverlayOpen } = await freshLock("hidden");
    expect(isOverlayOpen()).toBe(true);
  });

  it("is not fooled by some other overflow value", async () => {
    const { isOverlayOpen } = await freshLock("scroll");
    expect(isOverlayOpen()).toBe(false);
  });

  it("stays true while a counted lock sits on top of a raw one", async () => {
    const { acquireOverlayLock, isOverlayOpen } = await freshLock("hidden");
    const release = acquireOverlayLock();
    release();
    expect(isOverlayOpen()).toBe(true);
  });
});
