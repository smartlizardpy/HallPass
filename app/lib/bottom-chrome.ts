"use client";

/**
 * HallPass mobile — how much of the bottom of the viewport is already taken.
 *
 * THE BUG THIS EXISTS TO STOP. Two independent islands pin themselves to the
 * bottom of the screen: `MobileTabBar` (`fixed bottom-0 z-40`, four tabs tall) and
 * the offline pill in `PWA.tsx` (`fixed`, `z-50`, a small gap off the bottom).
 * Neither knew about the other, so on a phone that went offline the pill landed on
 * top of the bar and covered the middle two tabs. Nothing about that is visible on
 * a desktop, in a hydration warning, or in a test that renders one component at a
 * time — the two are only ever wrong TOGETHER, and only on a phone.
 *
 * THE CONTRACT. `--hp-bottom-chrome` is the height of the fixed chrome currently
 * occupying the bottom edge. Whoever OWNS that chrome publishes its height while
 * it is on screen ({@link publishBottomChrome}); anything that merely FLOATS above
 * the bottom edge offsets itself by the property ({@link floatingBottom}) instead
 * of measuring the safe-area inset itself. One publisher, many readers, so a new
 * bottom-floating element is correct without touching the tab bar — and the tab
 * bar can change height without hunting down everything that clears it.
 *
 * WHY A MEASURED PIXEL HEIGHT rather than the constant `calc(4rem + env(...))`
 * that the tab bar used to hardcode for its body padding. The bar renders only on
 * a touch device, but it ALSO carries `lg:hidden` — so on a large tablet that
 * reports a coarse, hoverless pointer at ≥1024px the component mounts while CSS
 * keeps the bar off screen. A constant would push the pill up 64px over nothing
 * there. `offsetHeight` is 0 for a `display: none` element, which is exactly the
 * answer we want to publish, and the measurement already includes the safe-area
 * inset the bar pads itself with — so the inset is counted once, not twice.
 *
 * The baseline value lives in `globals.css` on `:root`; the publisher's inline
 * style on `<html>` overrides it and cleanup removes the override, restoring the
 * baseline. That ordering is why nothing here needs to know whether a tab bar
 * exists on this route, on this device, or at this moment.
 */

/** The custom property both halves of the contract agree on. */
export const BOTTOM_CHROME_VAR = "--hp-bottom-chrome";

/**
 * What the bottom edge costs when NO chrome is published: the device's own
 * safe-area inset (the home-bar strip on a modern iPhone), and nothing on a
 * machine without one. Kept here as well as in `globals.css` so a reader can fall
 * back to it inline — a `var()` fallback covers the stylesheet not having loaded,
 * which is cheap insurance for an element that renders in the root layout.
 */
export const NO_BOTTOM_CHROME = "env(safe-area-inset-bottom, 0px)";

/**
 * The property value for a measured height.
 *
 * A height of 0 — the bar is `display: none`, or has not laid out yet — resolves
 * to {@link NO_BOTTOM_CHROME} rather than `0px`, because "no bar" still leaves the
 * safe-area inset to clear. Non-finite input (a detached node, a browser handing
 * back `NaN`) takes the same branch: an unknown height must degrade to the neutral
 * answer, never to a guess that shifts the UI.
 */
export function bottomChromeValue(height: number): string {
  if (!Number.isFinite(height) || height <= 0) return NO_BOTTOM_CHROME;
  return `${Math.round(height)}px`;
}

/**
 * The `bottom` for an element that floats `gap` above the bottom chrome.
 *
 * `gap` is a CSS length, so callers keep their own spacing in their own units
 * (`0.75rem` for the offline pill) instead of the shared module deciding it.
 */
export function floatingBottom(gap: string): string {
  return `calc(${gap} + var(${BOTTOM_CHROME_VAR}, ${NO_BOTTOM_CHROME}))`;
}

/** Publish the height of the chrome now occupying the bottom edge. */
export function publishBottomChrome(height: number): void {
  document.documentElement.style.setProperty(
    BOTTOM_CHROME_VAR,
    bottomChromeValue(height),
  );
}

/**
 * Drop the published height, restoring the `globals.css` baseline. Called when the
 * chrome unmounts or hides — leaving a stale value behind would strand every
 * floating element 64px too high for the rest of the session.
 */
export function clearBottomChrome(): void {
  document.documentElement.style.removeProperty(BOTTOM_CHROME_VAR);
}
