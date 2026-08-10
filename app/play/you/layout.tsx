/**
 * `/play/you` — the signed-in player's OWN surface, and the only one.
 *
 * This layout is the merge of what used to be two separate pages: `/play/account`
 * (identity, handle, username, badges, standings, admin/beta entry points, sign
 * out, self-delete) and `/play/friends` (the friends island). They were always
 * one thing to the person using them — "the bits that are mine" — and being two
 * pages meant two ways in, two headers, and a "Manage friends" teaser card whose
 * only job was to apologise for the split. Now there is one identity header and
 * three deep-linkable tabs beneath it:
 *
 *   /play/you           Profile   — badges, standings, a link to your public page
 *   /play/you/friends   Friends   — the friends island
 *   /play/you/settings  Settings  — identity, account, danger zone
 *
 * OWNER-ONLY, GATED ONCE. Every tab is behind the single `auth()` check below,
 * and when it fails `children` is never rendered — a page component under this
 * layout cannot execute for a signed-out visitor, because React never renders an
 * element the parent leaves out of its output. That is what makes the gate one
 * check rather than three that could drift apart.
 *
 * PRIVACY — the invariant carried over from `/play/account`, unchanged in
 * substance and slightly wider in reach:
 *   The email is rendered ONLY to the player themselves. It is read from the
 *   server-side `Player` (which carries `email`) rather than the public
 *   projection precisely because the owner is the one viewer allowed to see it,
 *   and the subtree is keyed on the viewer's OWN `session.user.playerId`. It is
 *   now in the persistent header, so it appears on all three tabs — still to the
 *   same one person, still on their own page. Nothing here ever renders another
 *   player's data; there is no route parameter to make that possible.
 *
 * ⚠ THE SERVICE WORKER MUST NEVER CACHE THIS. `public/sw.js` caches HTML
 * navigations into `hp-runtime`, which is shared by everyone using the browser
 * profile and survives deploys — so a cached page whose HTML contains one
 * person's email is that person's email shown to the next pupil on a shared
 * school machine. `/play/account` was in the never-intercept list for exactly
 * this reason and `/play/you` must be too.
 *
 * NOTE FOR THE FRIENDS TAB. `/play/friends` used to argue, correctly, that it
 * could be precached BECAUSE its server shell read no session and its HTML
 * contained nobody's data. That argument does not survive the merge: this layout
 * reads the session, so every tab below it — the friends tab included — is
 * dynamic and personal. See `friends/page.tsx`.
 *
 * DYNAMIC BY CONSTRUCTION. `auth()` is required to know who is looking, so this
 * route can never be prerendered, and must not be made to. It is exempt from the
 * "public pages must not touch auth()" rule that keeps `/`, `/game/[slug]` and
 * `/category/[category]` in the prerender manifest — those must stay precachable
 * and this must not be precached at all.
 *
 * Avatars are remote Google URLs rendered with a plain `<img>` (matching the
 * repo's GameCard / Arcade convention) plus `referrerPolicy="no-referrer"` so
 * Google serves them.
 */

import type { Metadata } from "next";
import { BackButton } from "@/app/components/BackButton";
import { Wordmark } from "@/app/components/Wordmark";
import { earnedBadges } from "@/app/lib/badges";
import { effectiveHandle } from "@/app/lib/players";
import { readBadgeStats, readOwnSocial, readPlayer } from "./_data";
import { NotSignedInCard } from "./_ui/NotSignedInCard";
import { YouTabs } from "./_ui/YouTabs";

/**
 * `noindex` for the whole subtree — AND REPEATED ON ALL THREE TAB PAGES.
 *
 * The duplication is deliberate, so nobody deletes it as redundant. Metadata is
 * merged SHALLOWLY from the root segment down and duplicate keys are REPLACED,
 * not deep-merged (`03-api-reference/04-functions/generate-metadata.md`,
 * "Merging"). Two consequences, pulling in opposite directions:
 *
 *   * This layout's `robots` overwrites the root layout's `index: true` for
 *     everything below it, and a tab that sets only `title` inherits it. So the
 *     layout alone is sufficient TODAY.
 *   * But any tab that ever sets its own `robots` for any reason replaces this
 *     one wholesale — silently, with no error, and the page would go back to
 *     being indexable because a nested field was dropped. A fourth tab added by
 *     someone who never read this file inherits correctly only by luck.
 *
 * That is too thin a thread for what is behind here. These pages carry a
 * school-age player's email, face, display name, what they play and who their
 * friends are, and `/play/account` and `/play/friends` both carried this exact
 * `robots` before they became redirects — a `redirect()` answers with a bodyless
 * 307 and emits no meta tag at all, so the responsibility moved HERE and now has
 * no other holder. `app/u/[username]/page.tsx` sets out at length why this is a
 * child-safety requirement rather than SEO hygiene, and why a `robots.txt`
 * Disallow is NOT a substitute: it stops the CRAWL, so the crawler never fetches
 * the page and never sees the noindex, while the URL can still be indexed from
 * inbound links alone — leaving the one directive that would remove it forever
 * unreadable. Belt and braces, on every segment.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Server-only formatter for "member since" — fixed locale, no hydration drift. */
function formatMonthYear(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

/** `1 badge` / `2 badges`, without pulling in an Intl.PluralRules for two words. */
function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export default async function YouLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Both of the ways identity can be missing — no session, or a session whose
  // player row has vanished — land on the same card. See `NotSignedInCard`.
  const player = await readPlayer();
  if (!player) return <NotSignedInCard />;

  // Both guarded reads, resolved together rather than in sequence. They are
  // `cache`d, so the Profile tab's badge shelf and the Settings tab's username
  // card reuse these results instead of re-querying.
  const [own, stats] = await Promise.all([readOwnSocial(), readBadgeStats()]);

  const display = effectiveHandle(player);
  const memberSince = formatMonthYear(player.createdAt);

  // A stat line assembled from what is actually known. A failed badge read drops
  // the two counts and keeps "member since"; an unparseable timestamp drops that
  // and keeps the counts; if nothing survives, the line is not rendered at all.
  // Omitting beats printing a confident zero for a number we could not read.
  const facts: string[] = [];
  if (stats) {
    facts.push(plural(earnedBadges(stats).length, "badge"));
    facts.push(plural(stats.friends, "friend"));
  }
  if (memberSince) facts.push(`Member since ${memberSince}`);

  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-5">
        {/* No header and no sidebar on these pages, so without this there is no
            way out except the browser's own back button — which on an installed
            PWA is not always on screen. */}
        <BackButton />

        <div className="text-center">
          <Wordmark size="text-3xl" dotClass="h-2 w-2" />
          <h1 className="mt-3 text-2xl font-black tracking-tight">Your profile</h1>
        </div>

        {/* IDENTITY — persistent across all three tabs. */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <div className="flex items-center gap-4">
            {player.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={player.image}
                alt=""
                width={64}
                height={64}
                referrerPolicy="no-referrer"
                className="h-16 w-16 shrink-0 rounded-full border border-border object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-2xl font-black text-muted">
                {display.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-xl font-black text-foreground">
                  {display}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand">
                  Verified player
                </span>
              </div>
              {/* The @username sits beside the display name on every surface,
                  because display handles are not unique — without it, copying a
                  friend's handle is a two-second impersonation. */}
              {own?.username && (
                <p className="truncate text-sm font-bold text-muted">
                  @{own.username}
                </p>
              )}
              {facts.length > 0 && (
                <p className="mt-1.5 text-xs text-muted">{facts.join(" · ")}</p>
              )}
              {/* Owner-only: shown to the signed-in player and no one else. */}
              <p className="truncate text-xs text-muted">{player.email}</p>
            </div>
          </div>
        </section>

        <YouTabs />

        {children}
      </div>
    </main>
  );
}
