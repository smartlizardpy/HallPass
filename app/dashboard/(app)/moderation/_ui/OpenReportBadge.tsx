"use client";

/**
 * The open-report count on the sidebar's Moderation link.
 *
 * WHY THIS IS A CLIENT COMPONENT THAT FETCHES, which looks like the wrong shape
 * until you try the alternatives. The badge is the whole justification for
 * putting Moderation SECOND in the nav — the point is that an admin on any
 * dashboard screen can see there is a child waiting on a decision. That needs a
 * live number in a component rendered by the `(app)` LAYOUT, and this surface
 * does not own the layout, so it cannot ask it to fetch a count server-side. The
 * options were: a dead optional prop nothing passes (a feature that silently
 * does nothing — the worst outcome), a new public route handler (another
 * endpoint to authorise), or this. `openReportCountAction` is one `count(*)`
 * served by the partial index `review_reports_open_idx`, gated by
 * `requireRole("admin")` like everything else on this surface, and — per the
 * Next.js docs on Server Functions — invoking one does NOT re-render the calling
 * page, so it costs a POST and nothing else. If the layout ever grows the count,
 * delete the effect and take it as a prop.
 *
 * FRESHNESS is deliberate, not incidental. The count is re-read on navigation
 * (`pathname`), on a 60s timer, and whenever the tab is brought back to the
 * front. The timer is the one that matters: working the queue keeps you on
 * `/dashboard/moderation`, where the post-action redirect changes only the
 * QUERY STRING — `usePathname()` does not see that, so navigation alone would
 * leave the badge reading "7" on the very screen where it had just been drained
 * to zero. (`useSearchParams` would see it, but it forces a Suspense boundary on
 * whatever renders it, and what renders this is the shared dashboard layout.)
 * The timer skips hidden tabs, so an admin who leaves the dashboard open in a
 * background tab all day generates no queries at all.
 *
 * Renders NOTHING at zero, and nothing while the first read is in flight: an
 * empty queue should look like an empty queue, and a "0" pill next to a nav
 * label is visual noise that trains people to ignore the badge.
 */

import { startTransition, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { openReportCountAction } from "../actions";

/** How often to re-read while the tab is in the foreground. */
const POLL_MS = 60_000;

export function OpenReportBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    // `cancelled` rather than an AbortController: a Server Function call is not
    // an abortable fetch we own, so the best we can do is refuse to write the
    // result of a stale read into state after unmount.
    let cancelled = false;

    // `startTransition` is the shape the Next.js docs prescribe for invoking a
    // Server Function from an effect: it keeps the resulting state update
    // non-urgent, so a slow count can never make the sidebar janky under a
    // navigation the admin actually asked for.
    const read = () => {
      startTransition(async () => {
        try {
          const n = await openReportCountAction();
          if (!cancelled) setCount(n);
        } catch {
          // The action already logs server-side. A failed read leaves the last
          // known count on screen rather than flashing the badge away, which
          // would read as "queue cleared" — the opposite of the truth.
        }
      });
    };

    read();

    // One guard serves both triggers: the timer must skip hidden tabs, and the
    // visibility listener fires on hide as well as show.
    const readIfVisible = () => {
      if (document.visibilityState === "visible") read();
    };

    const timer = window.setInterval(readIfVisible, POLL_MS);
    document.addEventListener("visibilitychange", readIfVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", readIfVisible);
    };
  }, [pathname]);

  if (!count) return null;

  return (
    <span
      // Matches the unread pill in `AccountMenu` so the two badges in the
      // product read as the same thing: "there is something here for you".
      className="ml-2 rounded-full bg-accent-pink px-1.5 py-0.5 text-[10px] font-black tabular-nums text-white"
      aria-label={`${count} open report${count === 1 ? "" : "s"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
