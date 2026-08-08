/**
 * Unit tests for the pure half of `bottom-chrome.ts`.
 *
 * The behaviour worth pinning down is the ZERO case. A measured height of 0 means
 * "there is no chrome on the bottom edge right now" — the tab bar is `lg:hidden`
 * on a large tablet, or has not laid out yet — and it must resolve to the device's
 * safe-area inset, NOT to `0px`. Collapsing it to `0px` would drop every floating
 * element into the iPhone home-bar strip, which is the same class of overlap this
 * module exists to prevent, just against a different piece of chrome. No type
 * error would catch it either: `0` and `65` are both perfectly good numbers.
 *
 * The publish/clear pair is not covered here — it is two `documentElement.style`
 * calls over `bottomChromeValue`, and the value is what has the decisions in it.
 */

import { describe, expect, it } from "vitest";

import {
  BOTTOM_CHROME_VAR,
  NO_BOTTOM_CHROME,
  bottomChromeValue,
  floatingBottom,
} from "./bottom-chrome";

describe("bottomChromeValue", () => {
  it("returns a pixel height for a measured bar", () => {
    expect(bottomChromeValue(65)).toBe("65px");
  });

  it("rounds a fractional height to whole pixels", () => {
    // Zoom and `env()` insets both produce sub-pixel heights; a long decimal in a
    // custom property is noise, and half a pixel of clearance is not a feature.
    expect(bottomChromeValue(64.5)).toBe("65px");
    expect(bottomChromeValue(64.2)).toBe("64px");
  });

  it("falls back to the safe-area inset when there is no chrome", () => {
    // The `display: none` answer — 0 height means no bar, but the home-bar strip
    // still has to be cleared.
    expect(bottomChromeValue(0)).toBe(NO_BOTTOM_CHROME);
  });

  it("treats a nonsense height as no chrome rather than guessing", () => {
    expect(bottomChromeValue(Number.NaN)).toBe(NO_BOTTOM_CHROME);
    expect(bottomChromeValue(Number.POSITIVE_INFINITY)).toBe(NO_BOTTOM_CHROME);
    expect(bottomChromeValue(-10)).toBe(NO_BOTTOM_CHROME);
  });
});

describe("floatingBottom", () => {
  it("adds the caller's gap to the published chrome height", () => {
    expect(floatingBottom("0.75rem")).toBe(
      `calc(0.75rem + var(${BOTTOM_CHROME_VAR}, ${NO_BOTTOM_CHROME}))`,
    );
  });

  it("carries an inline fallback for an unpublished property", () => {
    // Belt-and-braces for a reader that renders in the root layout: if nothing has
    // published a height — desktop, a hidden-bar route, or `globals.css` not yet
    // applied — the element still clears the safe-area inset instead of resolving
    // to an invalid `calc()` and losing its offset entirely.
    expect(floatingBottom("1rem")).toContain(NO_BOTTOM_CHROME);
  });
});
