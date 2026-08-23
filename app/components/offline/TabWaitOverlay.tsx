"use client";

/**
 * What the phone shows between tapping a tab and the page arriving.
 *
 * THE BUG THIS EXISTS FOR. `/play/you` is dynamic and uncacheable, so a tap on
 * the You tab cannot be answered from anything already on the device: the router
 * asks the server, and until the first byte comes back the only thing that
 * changes on screen is the tab turning purple. On a school wifi that is several
 * seconds of an app that looks like it ignored you — and the second tap, and the
 * "it's broken" that follows, are entirely reasonable responses to it.
 *
 * The two answers that already exist are both further down the road than this
 * moment: bones streamed from the SERVER (`app/play/you/layout.tsx`) arrive at
 * the speed of the first byte, and the `/offline/you` card needs a navigation to
 * fail first, plus a service worker current enough to know about it. This
 * overlay owes nothing to the network, so it is the only one that can answer
 * immediately.
 *
 * WHERE IT SITS IN THE STACK — `z-40`, the same level as BOTH the thing it must
 * cover and the thing it must not, with document order breaking the tie in the
 * right direction twice. `SiteHeader` is `sticky top-0 z-40` and belongs to the
 * page being left behind, so leaving it on top would put a search field over a
 * profile skeleton; the tab bar is `fixed z-40` and has to stay reachable,
 * because Home is precached and one tap away and covering it would turn a slow
 * page into a trapped one. `app/layout.tsx` renders `{children}` (header
 * included) and then `<MobileTabBar/>`, whose fragment is this overlay followed
 * by the bar — so later-in-DOM wins gives exactly header < overlay < bar. That
 * ordering is fixed by the root layout rather than by luck, but it IS the
 * mechanism: raising the bar's `z` or moving either component in that file
 * changes this, so change them together.
 *
 * The bones are the destination's own (`YouPageSkeleton`), not a generic
 * spinner, so the overlay and the page it is standing in for are the same shape
 * — the swap is a fill-in rather than a jump.
 */

import { useEffect } from "react";
import { Wordmark } from "@/app/components/Wordmark";
import { YouPageSkeleton } from "@/app/play/you/_ui/YouSkeleton";
import { floatingBottom } from "@/app/lib/bottom-chrome";
import type { TabGateView } from "@/app/lib/tab-gate";
import { OfflineNotice } from "./OfflineNotice";

export function TabWaitOverlay({
  view,
  destination,
  onDismiss,
}: {
  /** What to show. `none` is handled by the caller, which renders nothing. */
  view: Exclude<TabGateView, "none">;
  /** What the player was trying to open, for the offline card's sentence. */
  destination: string;
  /** Puts the offline card away. The player never left the page behind it. */
  onDismiss: () => void;
}) {
  // Escape closes the card, as it must for anything calling itself a dialog.
  // Above the branch, because hooks cannot live inside one. A phone has no
  // Escape key, but this component is not only ever seen on a phone: a hoverless
  // tablet under `lg` gets the same bar, and a keyboard may well be attached.
  useEffect(() => {
    if (view !== "offline") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, onDismiss]);

  if (view === "offline") {
    return (
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-background px-6 lg:hidden"
        role="alertdialog"
        aria-modal="true"
        aria-label="You are offline"
      >
        <OfflineNotice
          message={`Connect to wifi to open ${destination}. It lives on our servers, so it needs a connection.`}
        >
          <button
            type="button"
            onClick={onDismiss}
            autoFocus
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600"
          >
            Got it
          </button>
        </OfflineNotice>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 overflow-hidden bg-background px-6 py-10 lg:hidden"
      // The bones are `aria-hidden` decoration, so the announcement is here.
      // `polite`, not `assertive`: this is progress, not an alert, and it must
      // not interrupt whatever the player was having read to them.
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto max-w-2xl space-y-5">
        <p className="sr-only">Loading {destination}…</p>

        {/* THE CHROME IS REAL, NOT BONES. The wordmark and the heading are the
            same on every tab of the section and need nothing from the network,
            so drawing grey boxes where two known words go would be a placeholder
            for something we already have — and it would flicker into text when
            the page landed. What IS unknown gets bones: the back button, whose
            control is a client component belonging to the page that has not
            arrived yet. Everything below matches `YouFrame` in
            `app/play/you/layout.tsx` position for position, so the real page
            replaces this without moving anything. */}
        <div className="h-10 w-36 rounded-full bg-surface-2" aria-hidden />
        <div className="text-center">
          <Wordmark size="text-3xl" dotClass="h-2 w-2" />
          <h1 className="mt-3 text-2xl font-black tracking-tight">
            Your profile
          </h1>
        </div>

        <YouPageSkeleton />
      </div>

      {/* THE NOTICE IS AN ADDITION, NOT A REPLACEMENT. The page may still be on
          its way, so the bones stay underneath and this explains them. It floats
          clear of the tab bar the same way the offline pill does — see
          `app/lib/bottom-chrome.ts` — so the two never stack on the same pixels
          (they cannot both be up: `slow` means the device believes it is
          online). */}
      {view === "slow" && (
        <div
          className="pointer-events-none fixed left-1/2 z-40 w-[min(20rem,calc(100vw-3rem))] -translate-x-1/2 rounded-2xl border border-white/10 bg-foreground px-4 py-3 text-center shadow-lg"
          style={{ bottom: floatingBottom("0.75rem") }}
        >
          <p className="text-sm font-extrabold text-white">
            Slow connection &mdash; still loading
          </p>
          <p className="mt-1 text-xs font-semibold text-white/60">
            Hang on, or tap Home to keep playing.
          </p>
        </div>
      )}
    </div>
  );
}
