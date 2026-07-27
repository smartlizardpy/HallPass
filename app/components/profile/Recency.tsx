import type { ActivityRecency } from "@/app/lib/profile";

/**
 * The ONLY way a profile surface is allowed to say when something happened.
 *
 * `app/lib/profile.ts` coarsens every timestamp into four buckets before it ever
 * reaches a component, and this file is the render half of that promise: there is
 * no formatter here that takes a `Date`, so a future component cannot casually
 * print one. If a value is precise enough to be a presence signal — "last seen
 * 14:52" tells a school who is at a screen during period 5, who is off timetable,
 * and who is online at 1am — it cannot get through this module at all.
 *
 * The phrasing is deliberately vague in the same direction as the data. "This
 * week" is not "Monday", and "a while ago" is not "3 months ago", because a
 * relative number is still a number and subtracts back to a date.
 *
 * `null` renders NOTHING rather than "never" or "unknown". A player who has not
 * played anything gets a profile with no activity line at all, which is quieter
 * than a page announcing their absence.
 */

/** The bare bucket text. Lowercase so it composes after a prefix. */
export const RECENCY_LABEL: Record<ActivityRecency, string> = {
  today: "today",
  "this-week": "this week",
  "this-month": "this month",
  "a-while-ago": "a while ago",
};

/**
 * A pill for the profile header — `prefix` supplies the verb ("Active", "Played")
 * so the same four buckets read naturally in each place they appear.
 *
 * Muted, not brand-coloured: this is context, not an achievement, and a bright
 * chip announcing when someone was last online is the wrong emphasis for the one
 * fact on this page that people use to work out where a person is.
 */
export function RecencyChip({
  recency,
  prefix,
}: {
  recency: ActivityRecency | null;
  prefix: string;
}) {
  if (!recency) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[12px] font-bold text-muted">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted/60" />
      {prefix} {RECENCY_LABEL[recency]}
    </span>
  );
}
