/**
 * The bones of `/play/you` — one set of shapes, two places that need them.
 *
 * WHY THIS IS SHARED RATHER THAN WRITTEN TWICE. There are two different waits on
 * this route and they used to be answered by different things (one of them by
 * nothing at all):
 *
 *   1. MOVING BETWEEN TABS. `loading.tsx` covers this: layouts do not re-render
 *      on navigation, so the identity header and the tab strip stay put and only
 *      the body is re-fetched. It needs {@link YouBodySkeleton} alone.
 *   2. ARRIVING FROM ANOTHER PART OF THE SITE — tapping the You tab from the
 *      arcade. `loading.tsx` cannot help here: it is nested INSIDE the layout,
 *      and the layout reads `auth()` plus two Neon queries, so the navigation
 *      simply blocked until all of that had finished. On a school wifi that is
 *      seconds of a lit-up tab and nothing else. The layout now streams
 *      {@link YouPageSkeleton} behind a Suspense boundary instead.
 *
 * Two skeletons of the same page, maintained separately, is how the second one
 * ends up describing a layout the first one abandoned two commits ago. So the
 * shapes live here and the body half is a piece of the page half.
 *
 * NO `"use client"`: this is markup with no state, so it takes the boundary of
 * whoever imports it — `loading.tsx` (a server component) and the layout's
 * Suspense fallback both render it on the server.
 *
 * EVERYTHING IS `aria-hidden`, and the live region is the CALLER's job, not
 * this file's — the two callers announce different things ("Loading…" for a tab
 * swap, "Loading your profile…" for the whole page), and a row of empty boxes
 * read aloud helps nobody.
 */

/** The three card shapes of a tab body. Mirrors the real bodies' rhythm. */
export function YouBodySkeleton() {
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

/**
 * The whole section below the wordmark: identity header, tab strip, body.
 *
 * The measurements are the real ones, not approximations — `h-16 w-16` for the
 * avatar because that is what the layout renders, and a four-pill strip at the
 * tab links' own `py-2 text-sm` height. A skeleton whose shapes are the wrong
 * size makes the swap a jump, which is worse than no skeleton: the player has
 * already started reaching for where they think a control is.
 */
export function YouPageSkeleton() {
  return (
    <>
      <div className="space-y-5 motion-safe:animate-pulse" aria-hidden>
        {/* Identity header. */}
        <div className="rounded-xl border border-border bg-surface p-6">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 shrink-0 rounded-full bg-surface-2" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-5 w-40 rounded bg-surface-2" />
              <div className="h-3 w-24 rounded bg-surface-2" />
              <div className="h-3 w-52 rounded bg-surface-2" />
            </div>
          </div>
        </div>

        {/* Tab strip — same shell as `YouTabs`, four pills wide. */}
        <div className="flex gap-1 rounded-full border border-border bg-surface p-1">
          <div className="h-9 flex-1 rounded-full bg-surface-2" />
          <div className="h-9 flex-1 rounded-full bg-surface-2" />
          <div className="h-9 flex-1 rounded-full bg-surface-2" />
          <div className="h-9 flex-1 rounded-full bg-surface-2" />
        </div>
      </div>

      <YouBodySkeleton />
    </>
  );
}
