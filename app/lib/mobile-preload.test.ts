// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `mobile-preload` keeps its dedupe set and its in-flight count at MODULE scope,
 * so every test re-imports the module through `vi.resetModules()` rather than
 * calling a test-only reset export. A reset hatch would be a public API nothing
 * in the app uses, and it invites production code to reach for it.
 */
type Mod = typeof import("./mobile-preload");

/**
 * A stand-in for `HTMLImageElement`. jsdom does not fetch, so a real `Image()`
 * never fires `load` or `error` and the count under test could never come back
 * down. This records what was assigned and lets each test decide the outcome.
 */
class FakeImage {
  static instances: FakeImage[] = [];

  decoding = "";
  referrerPolicy = "";
  decodeCalls = 0;
  /** The referrer policy AT THE MOMENT `src` was assigned — see the test. */
  policyWhenFetched: string | null = null;

  private value = "";
  private listeners: Record<string, Array<() => void>> = {};

  constructor() {
    FakeImage.instances.push(this);
  }

  get src(): string {
    return this.value;
  }

  set src(next: string) {
    this.value = next;
    this.policyWhenFetched = this.referrerPolicy;
  }

  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }

  decode(): Promise<void> {
    this.decodeCalls += 1;
    return Promise.resolve();
  }

  fire(type: "load" | "error") {
    for (const fn of this.listeners[type] ?? []) fn();
  }
}

let mod: Mod;

beforeEach(async () => {
  FakeImage.instances = [];
  vi.stubGlobal("Image", FakeImage);
  vi.resetModules();
  mod = await import("./mobile-preload");
});

describe("preloadBudget", () => {
  it("allows everything when the connection is unknown", () => {
    // Safari ships no `navigator.connection`, so every iPhone lands here. A
    // missing API must not read as a bad connection.
    expect(mod.preloadBudget(null)).toBe("all");
    expect(mod.preloadBudget(undefined)).toBe("all");
    expect(mod.preloadBudget({})).toBe("all");
  });

  it("narrows to the first screen on data saver and the 2g tiers", () => {
    expect(mod.preloadBudget({ saveData: true })).toBe("first-screen");
    expect(mod.preloadBudget({ effectiveType: "slow-2g" })).toBe("first-screen");
    expect(mod.preloadBudget({ effectiveType: "2g" })).toBe("first-screen");
  });

  it("allows everything on the faster tiers", () => {
    expect(mod.preloadBudget({ effectiveType: "3g" })).toBe("all");
    expect(mod.preloadBudget({ effectiveType: "4g", saveData: false })).toBe("all");
  });
});

describe("coverUrls", () => {
  it("resolves the native convention and an explicit cover URL", () => {
    expect(
      mod.coverUrls([
        { slug: "pixel-slicer" },
        { slug: "hosted", externalUrl: "https://e.example/g", coverUrl: "https://blob/c.png" },
      ]),
    ).toEqual(["/games/pixel-slicer/cover.png", "https://blob/c.png"]);
  });

  it("drops a gradient-only external game rather than requesting a 404", () => {
    expect(mod.coverUrls([{ slug: "no-art", externalUrl: "https://e.example/g" }])).toEqual([]);
  });

  it("dedupes and preserves order", () => {
    expect(
      mod.coverUrls([{ slug: "a" }, { slug: "b" }, { slug: "a" }]),
    ).toEqual(["/games/a/cover.png", "/games/b/cover.png"]);
  });
});

describe("preloadImages", () => {
  it("skips empty entries and requests each URL once, across calls", () => {
    mod.preloadImages(["/a.png", null, "/a.png", undefined]);
    mod.preloadImages(["/a.png", "/b.png"]);

    expect(FakeImage.instances.map((i) => i.src)).toEqual(["/a.png", "/b.png"]);
  });

  it("applies the referrer policy before the fetch starts", () => {
    // Assigning `src` is what starts the request, so a policy set afterwards
    // would arrive too late to govern it — the leak `Avatar.tsx` guards against.
    mod.preloadImages(["https://lh3.googleusercontent.com/a"], {
      referrerPolicy: "no-referrer",
    });

    expect(FakeImage.instances[0].policyWhenFetched).toBe("no-referrer");
  });

  it("counts only first-screen images, and clears them once decoded", async () => {
    mod.preloadImages(["/one.png", "/two.png"], { firstScreen: true });
    mod.preloadImages(["/deferred.png"]);
    expect(mod.pendingFirstScreen()).toBe(2);

    FakeImage.instances[0].fire("load");
    FakeImage.instances[1].fire("load");
    // `decode()` resolves on a microtask, and settling deliberately waits for it
    // — "in the cache" is not yet "paints without a beat".
    expect(mod.pendingFirstScreen()).toBe(2);
    await Promise.resolve();
    await Promise.resolve();

    expect(mod.pendingFirstScreen()).toBe(0);
    expect(FakeImage.instances[0].decodeCalls).toBe(1);
    // The deferred image never joined the count, so it cannot hold the splash.
    expect(FakeImage.instances[2].decodeCalls).toBe(0);
  });

  it("clears the count for a cover that fails to load", async () => {
    mod.preloadImages(["/gone.png"], { firstScreen: true });
    expect(mod.pendingFirstScreen()).toBe(1);

    FakeImage.instances[0].fire("error");

    expect(mod.pendingFirstScreen()).toBe(0);
  });

  it("never double-counts an image that fires more than once", async () => {
    mod.preloadImages(["/one.png"], { firstScreen: true });

    FakeImage.instances[0].fire("load");
    await Promise.resolve();
    await Promise.resolve();
    FakeImage.instances[0].fire("error");

    expect(mod.pendingFirstScreen()).toBe(0);
  });
});
