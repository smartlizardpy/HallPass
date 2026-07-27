/**
 * `/u/<username>` — a player's PUBLIC PROFILE.
 *
 * The page is a thin renderer on purpose. Every access decision — who sees a full
 * profile, who sees a name and a face, who sees nothing at all — is made in
 * `app/lib/profile.ts`, which returns a discriminated union with no field for the
 * things this page must never print. There is no `email` on either shape, no
 * `players.id`, no Google `name`, no friend LIST and no precise timestamp,
 * because the type does not have them, not because this file remembers not to
 * render them. Read that module's docblock before changing anything here.
 *
 * WHY THIS PAGE IS `noindex` TWICE OVER, and why it is emphatically NOT a
 * `robots.txt` Disallow.
 *
 *   A Disallow prevents CRAWLING, and a crawler that never fetches the page never
 *   SEES the noindex. Google is explicit that a disallowed URL can still be
 *   indexed from inbound links alone — it surfaces as a bare URL with no snippet,
 *   and because the crawler is forbidden from fetching it, the very directive
 *   that would remove it can never be read. The two rules are in direct
 *   opposition: to be removed, a page must be crawlable AND noindex.
 *
 *   So the site's `robots.txt` stays `Allow: /` (see `app/robots.ts`) and the
 *   signal is sent twice on the response itself:
 *     1. `<meta name="robots" content="noindex, nofollow">` via
 *        {@link generateMetadata} — the layout's `index: true` is OVERWRITTEN,
 *        since Next lets the deepest segment that defines a nested metadata field
 *        win outright.
 *     2. An `X-Robots-Tag` response header, configured for `/u/:username*` in
 *        `next.config.ts`. The header is the load-bearing one here: a page can
 *        also be reached as a non-HTML response, and Next's `not-found.js`
 *        convention answers a STREAMED 404 with status 200, so the "it's a 404,
 *        nobody indexes those" assumption does not hold for the missing-profile
 *        path. A header does not care whether a parser reached the <head>.
 *
 *   WHY IT IS WORTH THE BELT AND BRACES. A search-indexed directory of minors'
 *   profiles — real photographs, self-chosen names, what they play and when — is
 *   precisely what a site used by school-age players must not create. It also
 *   defeats the username rename: a player who changes their name to get away from
 *   someone has done nothing at all if the old name is still in a results page
 *   for the next several weeks, with a cached snapshot behind it.
 *
 * WHAT IS DELIBERATELY NOT RENDERED, though the data is in hand:
 *   * `profile.stats` — the raw counters the badges are derived from. `totalPlays`
 *     and `accountAgeDays` answer "how much time does this child spend here",
 *     which is a different question from "what are they good at". The badges say
 *     the second thing without the first.
 *   * `profile.lockedBadges` — empty for everyone but the owner anyway, and
 *     `BadgeShelf` is called with NO `locked` prop so it cannot be filled in
 *     later by accident. On someone else's profile that list is a list of a
 *     child's shortcomings.
 *   * Any timestamp finer than the four `ActivityRecency` buckets.
 *   * The Open Graph card, which is inherited from the root layout unchanged. A
 *     profile link pasted into a group chat therefore unfurls as HALLPASS, not as
 *     a child's face and display name. Overriding it here would make sharing a
 *     profile an act of publishing one.
 *
 * DYNAMIC BY CONSTRUCTION, and that is fine here: `auth()` is required to know
 * who is looking, so this route can never be prerendered. It is exempt from the
 * "public pages must not touch auth()" rule that governs `/`, `/game/[slug]` and
 * `/category/[category]` — those must stay in `prerender-manifest.json` so
 * `scripts/build-sw-manifest.mjs` keeps precaching them, and this one must NOT be
 * precached at all. `public/sw.js` already lists `/u/` in its never-intercept
 * set: the runtime HTML cache is shared by everyone using a browser profile, so a
 * cached profile page on a school machine is one pupil's page shown to the next.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArcadeShell } from "@/app/components/ArcadeShell";
import { BadgeShelf } from "@/app/components/BadgeShelf";
import {
  AchievementWall,
  type AchievementGroup,
} from "@/app/components/profile/AchievementWall";
import { FriendButton } from "@/app/components/profile/FriendButton";
import { ProfileHeader } from "@/app/components/profile/ProfileHeader";
import {
  RecentPlays,
  type RecentPlayCard,
} from "@/app/components/profile/RecentPlays";
import {
  getEarnedAchievements,
  type EarnedAchievement,
} from "@/app/lib/achievements";
import { auth } from "@/app/lib/auth";
import type { Game } from "@/app/lib/games";
import { resolveCategories, resolveGames } from "@/app/lib/games-store";
import { getPublicProfileByUsername, type FullProfile } from "@/app/lib/profile";
import { social } from "@/app/lib/social";
import { USERNAME_MAX_LENGTH } from "@/app/lib/username";

/**
 * The meta half of the two-part noindex. `nofollow` as well as `noindex` because
 * profiles link to each other's games and boards, and a crawler that follows
 * outward from one profile is a crawler that has enumerated the directory it was
 * just told not to index. `noimageindex` keeps the avatar — frequently a real
 * photograph of a child — out of image search, which is a separate index with its
 * own removal process.
 */
const NOINDEX: Metadata["robots"] = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: { index: false, follow: false, noimageindex: true },
};

/** What the `players_username_format_chk` CHECK constraint permits. */
const USERNAME_SHAPE = /^[a-z0-9_]+$/;

/**
 * The tab title, built from the URL segment ALONE — no database read.
 *
 * Two reasons this does not look up the profile. First, `generateMetadata` and
 * the page render are separate invocations, so resolving the profile here would
 * double every query on the page's hot path to produce one line of text nobody
 * indexes. Second, a title derived from the lookup would differ between "no such
 * player" and "found but private", turning the tab title into the existence
 * oracle that `profile.ts` works to avoid.
 *
 * The segment is a raw URL path element, so anything that is not a legal username
 * collapses to a fixed word rather than being echoed back. Next escapes metadata
 * on the way out, so this is defence in depth against reflected junk in a shared
 * screenshot, not against injection.
 */
function titleFor(username: string): string {
  const wanted = username.trim().toLowerCase();
  if (wanted.length === 0 || wanted.length > USERNAME_MAX_LENGTH) return "Profile";
  return USERNAME_SHAPE.test(wanted) ? `@${wanted}` : "Profile";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  // `params` is a Promise in this version of Next, and its values arrive already
  // percent-decoded — decoding again here would turn a literal `%2F` in a
  // username into a path separator.
  const { username } = await params;
  return { title: titleFor(username), robots: NOINDEX };
}

/**
 * The INTERNAL player id for a profile, used only to key the achievements read.
 *
 * This is the Google subject id for a minor, so it stays a local `const` on the
 * server and is passed to exactly one store call. Nothing it produces reaches a
 * component prop: `AchievementWall` receives resolved names and icons, and the
 * one id that crosses to the browser is `publicId`, a UUID.
 *
 * The owner shortcut is not just a saved round trip: on your own profile the
 * session already holds the id, so the lookup would be asking the database to
 * tell us something we were handed at sign-in.
 *
 * A failure returns `null` and the wall is simply absent. Logged, not swallowed:
 * `db.ts` is explicit that the missing-column check must not be used to hide
 * errors generally, and a profile that silently loses its trophies during a Neon
 * outage is a bug report nobody can reproduce.
 */
async function ownerPlayerId(
  profile: FullProfile,
  viewerId: string | null,
): Promise<string | null> {
  if (profile.friendship === "self") return viewerId;
  try {
    return await social.internalIdFromPublicId(profile.publicId);
  } catch (error) {
    console.error("profile: public_id -> player id failed:", error);
    return null;
  }
}

/**
 * Group earned achievements by game, DROPPING any whose slug no longer resolves.
 *
 * This is where invariant "validate slugs against the resolved catalogue" is
 * satisfied for both achievements and plays: the catalogue is loaded once for
 * `ArcadeShell` and reused as the single arbiter of what exists. A slug can go
 * stale in `achievements`/`player_plays` whenever a game is removed or renamed in
 * the dashboard, and an unresolved one would otherwise render as a link to a 404
 * with an empty title.
 *
 * `Map` insertion order does the sorting for free: `earned` arrives newest-first,
 * so a game appears at the position of its most recent unlock and its
 * achievements stay in that order within the group. No comparator, and — since
 * this is the only thing `unlockedAt` is used for — no timestamp is rendered.
 */
function groupByGame(
  earned: EarnedAchievement[],
  gameBySlug: Map<string, Game>,
): AchievementGroup[] {
  const groups = new Map<string, AchievementGroup>();
  for (const item of earned) {
    const game = gameBySlug.get(item.slug);
    if (!game) continue;
    const group = groups.get(item.slug);
    if (group) group.items.push(item);
    else groups.set(item.slug, { slug: item.slug, title: game.title, items: [item] });
  }
  return [...groups.values()];
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const session = await auth();
  // `playerId`, NEVER `id`: `app/lib/auth.ts` documents that `user.id` is a fresh
  // random UUID on every login, so using it would make every viewer a stranger to
  // every profile — including making owners strangers to their own, which would
  // render a player's private profile as minimal to the one person allowed to see
  // it.
  const viewerId = session?.user?.playerId ?? null;

  // Issued together. The catalogue reads are cached and are needed by
  // `ArcadeShell` on every successful render, so paying for them alongside the
  // lookup beats a waterfall; the only wasted case is a 404, which is cheap.
  const [lookup, games, categories] = await Promise.all([
    getPublicProfileByUsername(username, viewerId),
    resolveGames(),
    resolveCategories(),
  ]);

  // A name nobody holds, a name nobody COULD hold, and a schema gap all land
  // here, indistinguishably. A blocked viewer does NOT: they get a minimal
  // profile, because an explicit 404 would advertise the block the moment they
  // signed out and saw the page reappear.
  if (!lookup.found) notFound();

  const profile = lookup.profile;
  const friendButton = profile.canSendFriendRequest ? (
    <FriendButton publicId={profile.publicId} displayName={profile.displayName} />
  ) : null;

  let body: React.ReactNode = null;

  if (lookup.visibility === "full") {
    const full = lookup.profile;
    const gameBySlug = new Map(games.map((game) => [game.slug, game]));

    const ownerId = await ownerPlayerId(full, viewerId);
    const earned = ownerId ? await getEarnedAchievements(ownerId) : [];

    const plays: RecentPlayCard[] = full.recentPlays.flatMap((play) => {
      const game = gameBySlug.get(play.slug);
      return game ? [{ game, recency: play.recency }] : [];
    });

    body = (
      <>
        {/* EARNED ONLY — no `locked` prop, ever. See the docblock. */}
        {full.badges.length > 0 && (
          <section className="rounded-3xl bg-white p-5 sm:p-6">
            <h2 className="text-[11px] font-black uppercase tracking-wider text-muted">
              Badges
            </h2>
            <div className="mt-4">
              <BadgeShelf earned={full.badges} />
            </div>
          </section>
        )}

        <AchievementWall groups={groupByGame(earned, gameBySlug)} />
        <RecentPlays plays={plays} />
      </>
    );
  }

  return (
    <ArcadeShell
      games={games}
      categories={categories}
      // Empty, not the "All" default: a profile is not a category, and
      // highlighting one in the sidebar would claim the viewer is browsing the
      // catalogue. No item equals "", so nothing lights up.
      activeCategory=""
    >
      <div className="mx-auto w-full max-w-5xl space-y-5 px-3 pb-10 pt-2 sm:px-8">
        <ProfileHeader profile={profile} action={friendButton} />
        {body}
      </div>
    </ArcadeShell>
  );
}
