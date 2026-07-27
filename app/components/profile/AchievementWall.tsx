import Link from "next/link";
import type { EarnedAchievement } from "@/app/lib/achievements";

/**
 * EARNED game achievements on a profile, grouped by the game that granted them.
 *
 * WHY THERE ARE NO DATES ANYWHERE ON THIS WALL. `EarnedAchievement.unlockedAt` is
 * a precise ISO timestamp, and the page uses it — for ORDERING only. Rendering it,
 * even softened to a calendar date, would put back exactly the presence signal
 * `coarsenActivity` exists to strip: a cluster of unlocks stamped 14:52 says who
 * was at a screen during period 5, and a run of them at 01:10 says something a
 * public page has no business saying about a child. Recency is still legible —
 * the groups arrive newest-first — it just isn't quantified.
 *
 * WHY UNEARNED ACHIEVEMENTS ARE NOT SHOWN, not even as a locked count. Same rule
 * as `lockedBadges()` in `badges.ts`: on someone else's profile a list of what
 * they have not managed is a list of their shortcomings. It also protects the
 * SECRET ones, whose whole point is that their names are not public — the store
 * redacts them, but the cheapest way not to leak a redacted name is to not ask
 * for it.
 *
 * WHY AN EMPTY WALL RENDERS NOTHING AT ALL. Same reason. "No achievements yet" on
 * a stranger's page is a sentence about a person, not about a page, and a profile
 * with nothing on it should simply be short.
 *
 * NO AGGREGATE TOTAL is displayed. The page reads a CAPPED, newest-first slice
 * (see `earnedForPlayer`), so any "1,240 points" line here would quietly be the
 * sum of the visible slice and would stop being true for the players who have
 * earned the most — the exact people who would notice.
 */

/** One game's worth of a player's earned achievements. Built by the page. */
export type AchievementGroup = {
  /** A slug already resolved against the live catalogue — see the page. */
  slug: string;
  title: string;
  /** Newest first, as returned by the store. */
  items: EarnedAchievement[];
};

export function AchievementWall({ groups }: { groups: AchievementGroup[] }) {
  if (groups.length === 0) return null;

  return (
    <section className="rounded-3xl bg-white p-5 sm:p-6">
      <h2 className="text-[11px] font-black uppercase tracking-wider text-muted">
        Achievements
      </h2>

      <div className="mt-4 space-y-5">
        {groups.map((group) => (
          <div key={group.slug}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link
                href={`/game/${group.slug}`}
                prefetch={false}
                className="text-[15px] font-black tracking-tight text-zinc-900 hover:text-brand"
              >
                {group.title}
              </Link>
              <span className="text-[12px] font-bold text-muted">
                {group.items.length} unlocked
              </span>
            </div>

            <ul className="mt-2 flex flex-wrap gap-2">
              {group.items.map((item) => (
                // `key` is unique only WITHIN a game — the store's `(slug, key)`
                // unique index is what makes it so — hence the composite key.
                <li key={`${group.slug}:${item.key}`}>
                  <span
                    // Mirrors BadgeShelf: `title` for pointers and the same text
                    // in an sr-only span, because a tooltip alone is unreachable
                    // by keyboard.
                    title={item.description || undefined}
                    className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[12px] font-black text-zinc-800"
                  >
                    <span aria-hidden>{item.icon}</span>
                    {item.name}
                    {item.points > 0 && (
                      <span className="font-extrabold text-muted">
                        {item.points}
                        <span className="sr-only"> points</span>
                        <span aria-hidden> pts</span>
                      </span>
                    )}
                    {item.description && (
                      <span className="sr-only"> — {item.description}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
