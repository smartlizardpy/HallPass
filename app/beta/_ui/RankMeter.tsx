/**
 * HallPass beta — the XP and rank panel.
 *
 * The tester's headline: where they stand, and how far the next rank is. Server
 * component; `RankProgress` is derived from a single summed integer, so there is
 * nothing to fetch and no state to hold.
 *
 * THE BAR IS NOT A `<progress>` ELEMENT. Native progress styling is famously
 * inconsistent across engines and needs three vendor pseudo-element rules to
 * tame, which is a lot of stylesheet for a div with a width. The ARIA role is
 * spelled out instead, so assistive tech gets the same information a native
 * element would have carried.
 *
 * MOTION IS OPT-OUT. The fill transitions on width, and `globals.css` has a
 * blanket `prefers-reduced-motion` block covering the site's other animations —
 * a `motion-reduce:transition-none` here keeps this consistent with that
 * without needing another entry in the global stylesheet.
 */

import type { RankProgress } from "@/app/lib/beta/xp";

export function RankMeter({
  xp,
  rank,
  className = "",
}: {
  xp: number;
  rank: RankProgress;
  className?: string;
}) {
  const pct = Math.round(rank.fraction * 100);

  return (
    <section
      className={`rounded-xl border border-border bg-surface p-6 ${className}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-muted">
            Your rank
          </h2>
          <p className="mt-1 text-2xl font-black tracking-tight text-zinc-900">
            {rank.name}
          </p>
        </div>
        <p className="text-right">
          <span className="text-2xl font-black tabular-nums text-brand">
            {xp.toLocaleString("en-US")}
          </span>{" "}
          <span className="text-sm font-black uppercase tracking-wide text-muted">
            XP
          </span>
        </p>
      </div>

      <div
        className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={
          rank.next
            ? `${pct}% of the way from ${rank.name} to ${rank.next.name}`
            : `${rank.name} — highest rank reached`
        }
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="mt-3 text-sm font-semibold text-muted">
        {rank.next ? (
          <>
            <span className="font-black text-zinc-900">
              {rank.toNext.toLocaleString("en-US")} XP
            </span>{" "}
            to {rank.next.name}
          </>
        ) : (
          // Deliberately not "0 XP to null" — the top of the ladder is a state,
          // not a gap of zero.
          <>Top rank. Nothing left to climb.</>
        )}
      </p>
    </section>
  );
}
