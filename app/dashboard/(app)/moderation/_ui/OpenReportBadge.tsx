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

import { useState } from "react";
import { usePathname } from "next/navigation";
import { usePolling } from "../../_ui/usePolling";

/** Base wait while the count is changing; it backs off to MAX_MS when it is not. */
const POLL_MS = 300_000;
const MAX_MS = 900_000;
/** No input for this long and the badge stops asking until the admin is back. */
const IDLE_STOP_MS = 1_800_000;

/** A plain GET, not a Server Function: it runs none of the current page's code. */
async function readCount(): Promise<number> {
  const res = await fetch("/api/v1/admin/open-report-count", { cache: "no-store" });
  if (!res.ok) throw new Error(`open report count ${res.status}`);
  const body = (await res.json()) as { count: number };
  return body.count;
}

export function OpenReportBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  // A failed read leaves the last known count on screen rather than flashing the
  // badge away, which would read as "queue cleared" — the opposite of the truth.
  usePolling({
    read: readCount,
    onData: setCount,
    baseMs: POLL_MS,
    maxMs: MAX_MS,
    idleStopMs: IDLE_STOP_MS,
    resetKey: pathname,
  });

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
