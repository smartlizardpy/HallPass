import Link from "next/link";
import { CoverImage } from "@/app/components/CoverImage";
import type { Game } from "@/app/lib/games";
import type { ActivityRecency } from "@/app/lib/profile";
import { RECENCY_LABEL } from "./Recency";

/**
 * "Recently played" on a profile — six tiles, each with a COARSE recency and
 * nothing finer.
 *
 * WHY NOT `GameCard`. That component's hover ▶ calls `useOpenGame()`, which only
 * resolves inside the client half of `ArcadeShell`, and it takes an `onPlay`
 * function prop — neither of which a server component can supply. A profile tile
 * also wants different behaviour: a plain navigation to the store page, which is
 * what a card click does there anyway. Reimplementing the ▶ here would mean
 * shipping a second client island to duplicate a control the catalogue already
 * has.
 *
 * WHY THE PAGE RESOLVES THE SLUGS AND THIS DOESN'T. `RecentPlay.slug` comes
 * straight out of `player_plays` and is deliberately NOT checked against the
 * catalogue by `profile.ts` (it says so, and why). The page already loads the
 * resolved catalogue for `ArcadeShell`, so it drops the dead slugs from the same
 * `Map` it uses for everything else — one resolution, one source of truth, and
 * this component never has to know that a slug can be a lie.
 *
 * SIX IS A FEATURE. `PROFILE_RECENT_PLAYS` is small on purpose: a long, ordered
 * history of everything someone has opened starts to describe when they use a
 * computer and for how long, which is a different thing from "what are they
 * into".
 */

/** One tile: a resolved catalogue entry plus its coarse recency. */
export type RecentPlayCard = {
  game: Game;
  recency: ActivityRecency | null;
};

export function RecentPlays({ plays }: { plays: RecentPlayCard[] }) {
  // Nothing to say beats "hasn't played anything". Same rule as the achievement
  // wall: an empty profile should be short, not annotated.
  if (plays.length === 0) return null;

  return (
    <section className="rounded-3xl bg-white p-5 sm:p-6">
      <h2 className="text-[11px] font-black uppercase tracking-wider text-muted">
        Recently played
      </h2>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
        {plays.map(({ game, recency }) => (
          <Link
            key={game.slug}
            href={`/game/${game.slug}`}
            // `prefetch={false}` matches GameCard: a profile can put six store
            // pages on screen at once, and prefetching all of them is a lot of
            // traffic for a school connection to spend on a page nobody may click.
            prefetch={false}
            className="card group flex flex-col text-left"
          >
            <div className="relative aspect-square overflow-hidden rounded-3xl bg-zinc-900">
              <CoverImage game={game} className="card-art" />
            </div>
            <h3 className="mt-2.5 truncate px-1 text-[14px] font-extrabold leading-tight text-zinc-900 group-hover:text-brand">
              {game.title}
            </h3>
            {recency && (
              <p className="truncate px-1 text-[12px] font-semibold text-muted">
                Played {RECENCY_LABEL[recency]}
              </p>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
