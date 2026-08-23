/**
 * Instant fallback for the `/play/you` tabs.
 *
 * WHAT THIS ACTUALLY BUYS, stated honestly, because the obvious reading is
 * wrong. `loading.js` is nested INSIDE `layout.js` and wraps `page.js` and the
 * segments below it in a Suspense boundary — it does NOT wrap the layout in its
 * own segment. And the Next docs are explicit that when a layout reads runtime
 * data (this one calls `auth()`, plus a couple of Neon queries for the identity
 * header) the fallback is not shown for it: without Cache Components the
 * navigation simply blocks until the layout has rendered.
 * (`03-file-conventions/loading.md`, "Good to know"; `layout.md`, "Interaction
 * with loading.js".)
 *
 * So this does nothing for a cold arrival at `/play/you` — that wait belongs to
 * the layout, WHICH NOW ANSWERS IT ITSELF: the layout streams its own skeleton
 * from behind a Suspense boundary, so tapping the You tab from the arcade shows
 * bones rather than a lit-up tab and a blank pause. See `layout.tsx` and
 * `_ui/YouSkeleton.tsx`.
 *
 * What THIS covers is the other case, the one that happens repeatedly: moving
 * BETWEEN the three tabs. Layouts do not re-render on navigation, so the
 * identity header and the tab strip stay on screen and interactive while only
 * the tab body is re-fetched — and the standings, badge and role queries behind
 * a tab body are exactly the sort of wait that otherwise leaves a tap looking
 * ignored. This is what fills that gap.
 *
 * It therefore renders ONLY the body shell. No wordmark, no heading, no avatar:
 * those are the layout's, they are already on screen, and drawing skeleton
 * versions of them here would flash a placeholder over content that never went
 * away. The shapes mirror the tab bodies so the swap is a fill-in, not a jump —
 * and they are the SAME shapes the layout's own fallback uses, because two
 * hand-maintained skeletons of one page drift.
 */
import { YouBodySkeleton } from "./_ui/YouSkeleton";

export default function Loading() {
  return (
    <>
      {/* The shapes themselves are `aria-hidden` — they are decoration, and
          reading out a row of empty boxes helps nobody. But hiding them and
          nothing else made a tab switch announce NOTHING at all: the layout does
          not re-render, so to a screen-reader user the tap simply produced
          silence until the new body arrived. This live region is the
          announcement. */}
      <p role="status" className="sr-only">
        Loading…
      </p>
      <YouBodySkeleton />
    </>
  );
}
