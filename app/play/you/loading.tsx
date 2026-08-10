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
 * the layout. What it covers is the case that actually happens repeatedly:
 * moving BETWEEN the three tabs. Layouts do not re-render on navigation, so the
 * identity header and the tab strip stay on screen and interactive while only
 * the tab body is re-fetched — and the standings, badge and role queries behind
 * a tab body are exactly the sort of wait that otherwise leaves a tap looking
 * ignored. This is what fills that gap.
 *
 * It therefore renders ONLY the body shell. No wordmark, no heading, no avatar:
 * those are the layout's, they are already on screen, and drawing skeleton
 * versions of them here would flash a placeholder over content that never went
 * away. The shapes mirror the tab bodies so the swap is a fill-in, not a jump.
 */
export default function Loading() {
  return (
    <div className="space-y-5 motion-safe:animate-pulse" aria-hidden>
      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="h-4 w-40 rounded bg-surface-2" />
        <div className="mt-3 h-3 w-56 rounded bg-surface-2" />
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="h-4 w-32 rounded bg-surface-2" />
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="h-7 w-24 rounded-full bg-surface-2" />
          <div className="h-7 w-28 rounded-full bg-surface-2" />
          <div className="h-7 w-20 rounded-full bg-surface-2" />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="h-4 w-36 rounded bg-surface-2" />
        <div className="mt-4 space-y-2">
          <div className="h-14 w-full rounded-lg bg-surface-2" />
          <div className="h-14 w-full rounded-lg bg-surface-2" />
        </div>
      </div>
    </div>
  );
}
