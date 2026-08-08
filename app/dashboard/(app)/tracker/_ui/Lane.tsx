/**
 * One status lane on the tracker board.
 *
 * A plain server-rendered `<section>`, deliberately. The first version of this
 * component was a `<details>` that collapsed on mobile and was forced open by
 * CSS on desktop; that was dropped because forcing a `<details>` open with CSS
 * is not reliable across engines — the closed state is hidden by internal
 * rendering rather than by a `display` rule a child can override — and the
 * workaround meant rendering the lane's children twice.
 *
 * So the responsive behaviour lives entirely in the parent's layout instead:
 * lanes are a horizontally scrolling row of fixed-width columns on desktop, and
 * a plain vertical stack on a phone. Six Kanban columns side by side on a 390px
 * screen is the most common way a board like this becomes unusable, and
 * `mobile.md` treats that surface as real. Nothing here can render wrong.
 *
 * An empty lane still renders, so the board keeps a stable shape and a reader
 * can see that "Building" is genuinely empty rather than missing — which for
 * this board is a real answer, not an absence.
 */

import type { ReactNode } from "react";
import {
  STATUS_HINT,
  STATUS_LABEL,
  type TrackerStatus,
} from "@/app/lib/tracker/config";

export function Lane({
  status,
  count,
  children,
}: {
  status: TrackerStatus;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface-2/40 p-3 md:w-72 md:shrink-0">
      <header className="mb-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-foreground">
            {STATUS_LABEL[status]}
          </h2>
          <span className="text-xs font-bold text-muted">{count}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted">{STATUS_HINT[status]}</p>
      </header>

      {count === 0 ? (
        <p className="text-xs text-muted italic">Nothing here.</p>
      ) : (
        <div className="flex flex-col gap-2">{children}</div>
      )}
    </section>
  );
}
