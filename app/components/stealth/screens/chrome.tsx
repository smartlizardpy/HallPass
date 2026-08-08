/**
 * HallPass — shared chrome for the panic screens.
 *
 * The three disguises in this directory are independent recreations, but they
 * all impersonate the same vendor's web apps, so the handful of details that
 * MUST agree between them live here: the typeface, the wordmark, and the app
 * -switcher grid that sits in the corner of every one of those products.
 *
 * Two rules keep this file small on purpose:
 *
 *   1. ONLY genuinely cross-screen primitives belong here. A flourish that one
 *      screen needs — a Docs ruler, a Classroom banner, a search result row —
 *      is that screen's own business and stays in its own file. This directory
 *      is edited a screen at a time, and a shared file that grows to hold every
 *      widget becomes the one place every change collides.
 *   2. NO third-party assets. Everything is hand-drawn markup in the right
 *      colours — an approximation, not the vendors' actual marks. A panic screen
 *      only has to survive a glance from across a room, and shipping someone
 *      else's logo to do that is not a trade worth making.
 */

import type { ReactElement } from "react";

/**
 * The panic screens deliberately opt OUT of the site's Nunito. Real Google
 * surfaces render in Arial/Roboto, and the arcade's rounded display font is the
 * single fastest way to give the disguise away.
 */
export const SANS = "Arial, Roboto, Helvetica, sans-serif";

/** The wordmark's per-letter colours, in order. */
const GOOGLE_LETTERS: ReadonlyArray<readonly [string, string]> = [
  ["G", "#4285F4"],
  ["o", "#EA4335"],
  ["o", "#FBBC05"],
  ["g", "#4285F4"],
  ["l", "#0F9D58"],
  ["e", "#EA4335"],
];

/**
 * The six-letter wordmark. `size` is the rendered cap height in pixels; the
 * caller positions it. Marked `aria-hidden` — it is decoration inside a
 * `role="presentation"` overlay, and a screen reader announcing a brand name
 * the page is only pretending to be would be a lie to assistive tech.
 */
export function GoogleWordmark({ size = 26 }: { size?: number }): ReactElement {
  return (
    <span
      aria-hidden
      style={{ fontFamily: SANS, fontSize: size, letterSpacing: "-0.02em" }}
      className="font-medium leading-none"
    >
      {GOOGLE_LETTERS.map(([ch, color], i) => (
        <span key={i} style={{ color }}>
          {ch}
        </span>
      ))}
    </span>
  );
}

/** The 3×3 app-switcher dots that sit top-right of every Google surface. */
export function AppsGrid({ className = "" }: { className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden
      className={className}
      fill="#5f6368"
    >
      {[5, 12, 19].map((cy) =>
        [5, 12, 19].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" />),
      )}
    </svg>
  );
}

/** The signed-in account bubble: a single initial on a flat colour. */
export function Avatar({
  initial = "A",
  size = 32,
  color = "#7b1fa2",
}: {
  initial?: string;
  size?: number;
  color?: string;
}): ReactElement {
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.44 }}
    >
      {initial}
    </div>
  );
}
