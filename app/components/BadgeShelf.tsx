import type { Badge } from "../lib/badges";

/**
 * A row of earned badges, with optional locked ones greyed out beside them.
 *
 * Locked badges are shown ONLY to the owner. On someone else's profile, a list
 * of what they have not achieved is just a list of their shortcomings, which is
 * a strange thing to publish about a child.
 *
 * Server component — badges are derived from data the page already has, so there
 * is nothing to fetch and no state to hold.
 */

/** Per-category tint. Keeps the shelf readable at a glance without a legend. */
const BADGE_TONES: Record<Badge["tone"], string> = {
  score: "bg-amber-50 text-amber-900",
  play: "bg-brand-50 text-brand",
  review: "bg-emerald-50 text-emerald-900",
  social: "bg-sky-50 text-sky-900",
  time: "bg-surface-2 text-zinc-700",
};

export function BadgeShelf({
  earned,
  locked,
  emptyLabel = "No badges yet — play a few games.",
}: {
  earned: Badge[];
  /** Omit on another player's profile. */
  locked?: Badge[];
  emptyLabel?: string;
}) {
  if (earned.length === 0 && (!locked || locked.length === 0)) {
    return <p className="text-sm font-semibold text-muted">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      {earned.length === 0 ? (
        <p className="text-sm font-semibold text-muted">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {earned.map((badge) => (
            <li key={badge.id}>
              <span
                // `title` for pointers, and the same text in the label for
                // screen readers — a tooltip alone is unreachable by keyboard.
                title={badge.description}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-black ${
                  BADGE_TONES[badge.tone]
                }`}
              >
                <span aria-hidden>{badge.icon}</span>
                {badge.label}
                <span className="sr-only"> — {badge.description}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {locked && locked.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-bold text-muted hover:text-zinc-900">
            {locked.length} still to earn
          </summary>
          <ul className="mt-2 flex flex-wrap gap-2">
            {locked.map((badge) => (
              <li key={badge.id}>
                <span
                  title={badge.description}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] font-bold text-muted opacity-70"
                >
                  <span aria-hidden className="grayscale">
                    {badge.icon}
                  </span>
                  {badge.label}
                  <span className="sr-only"> — not yet earned: {badge.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
