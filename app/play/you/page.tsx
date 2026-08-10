/**
 * `/play/you` — the PROFILE tab.
 *
 * What the player has to show for themselves: the badges they have earned (and,
 * because this is their own page, the ones still to earn), where they stand on
 * every board they have entered, and a way to see the version of themselves that
 * everybody else sees.
 *
 * Identity, the email, and the signed-out state are all handled once by
 * `layout.tsx` — this component only runs for a signed-in owner. It still
 * re-reads the id rather than trusting anything ambient, and every read here is
 * `cache`d or guarded; see `_data.ts`.
 *
 * THE PUBLIC-PROFILE LINK IS THE ONE GENUINELY NEW THING on this page. Until now
 * a player had no way to see what `/u/<username>` shows about them: they could
 * pick a username, set a visibility, earn badges, and never once look at the
 * result. "What do other people see?" is the question somebody asks right before
 * they decide whether to lock their profile down, and it deserves an answer that
 * is one tap away rather than a URL they have to construct by hand.
 *
 * When they have no username there is no public profile to link to —
 * `/u/[username]` is the only route there is — so the card says so and points at
 * the tab where they can claim one. A dead link would be worse than no link.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { BadgeShelf } from "@/app/components/BadgeShelf";
import { earnedBadges, lockedBadges } from "@/app/lib/badges";
import { store } from "@/app/lib/scoreboard";
import { readBadgeStats, readOwnSocial, readPlayerId } from "./_data";

export const metadata: Metadata = {
  title: "Your profile",
  // Repeated from the layout on purpose — see the long note there. A personal
  // surface must never enter a search index, and this is the segment that would
  // silently lose it if anyone ever adds another `robots` field here.
  robots: { index: false, follow: false },
};

/**
 * Rank badge classes. #1 gets a gold-ish amber treatment (the podium spot);
 * everyone else gets the brand tint.
 */
function rankBadgeClasses(rank: number): string {
  return rank === 1
    ? "border border-amber-300 bg-amber-100 text-amber-800"
    : "border border-brand/20 bg-brand-50 text-brand";
}

export default async function YouProfilePage() {
  const playerId = await readPlayerId();
  // The layout does not render `children` without a player, so this is belt and
  // braces rather than a live path — but it is also what narrows the type, and a
  // page that quietly assumed identity would be the wrong kind of shortcut.
  if (!playerId) return null;

  const [stats, own, standings] = await Promise.all([
    // Both `cache`d and already resolved by the layout's header — free here.
    readBadgeStats(),
    readOwnSocial(),
    // Guarded on its own, like every other read on this surface: a transient
    // Neon hiccup must degrade the standings list to its empty state, not 500
    // an owner-only page whose other sections are fine. Mirrors the resilient
    // public leaderboard route.
    store.getPlayerStandings(playerId).catch((error) => {
      console.error(`profile standings read failed for ${playerId}:`, error);
      return [];
    }),
  ]);

  return (
    <div className="space-y-5">
      {/* PUBLIC PROFILE ---------------------------------------------------- */}
      {own?.username ? (
        <Link
          href={`/u/${encodeURIComponent(own.username)}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-6 transition hover:border-brand"
        >
          <div className="min-w-0">
            <div className="text-sm font-black uppercase tracking-wide text-foreground">
              View your public profile
            </div>
            <p className="mt-1 text-xs font-semibold text-muted">
              Exactly what other players see at /u/{own.username}.
            </p>
          </div>
          <span aria-hidden className="shrink-0 text-xl font-black text-brand">
            →
          </span>
        </Link>
      ) : (
        <section className="rounded-xl border border-dashed border-border bg-surface p-6">
          <h2 className="text-sm font-black uppercase tracking-wide text-foreground">
            Your public profile
          </h2>
          <p className="mt-2 text-sm text-muted">
            You don&rsquo;t have one yet — a public profile lives at your
            @username, so pick one and other players can find you there.
          </p>
          <Link
            href="/play/you/settings"
            className="mt-4 inline-block rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 transition hover:bg-surface-2"
          >
            Pick a username
          </Link>
        </section>
      )}

      {/* BADGES ------------------------------------------------------------ */}
      {stats && (
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-sm font-black uppercase tracking-wide text-zinc-900">
            Badges
          </h2>
          <p className="mt-2 text-sm text-muted">
            Earned automatically from what you play, score and write.
          </p>
          <div className="mt-4">
            <BadgeShelf
              earned={earnedBadges(stats)}
              // Owner-only view, so the locked list is fine to show here. It is
              // NOT passed on `/u/<username>`, where a list of what a child has
              // not achieved is just a list of their shortcomings.
              locked={lockedBadges(stats)}
              emptyLabel="No badges yet — play a few games and they'll show up here."
            />
          </div>
        </section>
      )}

      {/* YOUR LEADERBOARDS -------------------------------------------------- */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="text-sm font-black uppercase tracking-wide text-foreground">
          Your leaderboards
        </h2>
        {standings.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-sm text-muted">
            Play a game while signed in to climb the boards.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {standings.map((s) => (
              <li
                key={s.boardId}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3"
              >
                <div className="min-w-0">
                  {s.gameSlug ? (
                    <Link
                      href={`/game/${s.gameSlug}`}
                      className="truncate font-bold text-foreground hover:text-brand"
                    >
                      {s.title}
                    </Link>
                  ) : (
                    <span className="block truncate font-bold text-foreground">
                      {s.title}
                    </span>
                  )}
                  <div className="mt-0.5 text-xs text-muted">
                    Best {s.best.toLocaleString("en-US")}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-sm font-black tabular-nums ${rankBadgeClasses(
                    s.rank,
                  )}`}
                >
                  #{s.rank}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
