/**
 * HallPass — the owner-only reads behind `/play/you`, deduped per request.
 *
 * WHY THIS MODULE EXISTS. `/play/you` is a layout plus three tabs, and the
 * layout and the tab underneath it both want the same facts: who is signed in,
 * their player row, their social row, their badge counts. Layouts cannot pass
 * data to their children (`node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/layout.md`, "Fetching Data"), and the framework's own
 * answer is to read the same thing in both places and dedupe with React
 * `cache`. That is exactly what every export below does: call it from the layout
 * AND from the page and Neon still sees ONE query per request.
 *
 * FAIL-SOFT, PER READ — carried over from the account page this replaces, and
 * deliberately NOT collapsed into one unguarded `Promise.all`. The social and
 * badge reads touch columns and tables that do not exist until migrations
 * 007/008 have been applied, and Neon is a network hop that can simply have a
 * bad second. Each of those degrades to `null` on its own so a missing username
 * card cannot take the badge shelf with it, nor either of them the page.
 *
 * `readPlayer` is the ONE read that is not guarded, and that is deliberate too.
 * Degrading it to `null` would render "you are not signed in" to somebody who
 * demonstrably is — the worst possible answer to a transient database error,
 * and one that invites them to sign in again to fix a problem that is not
 * theirs. A 500 is the honest outcome. This matches `/play/account` exactly.
 *
 * PRIVACY. {@link readPlayer} returns the server-side `Player`, which CARRIES
 * THE EMAIL (`app/lib/players.ts` is explicit that the public projection is
 * email-free by construction and that this shape must stay server-side). It is
 * safe here only because every caller is a server component under `/play/you`,
 * a subtree gated on the viewer's own `playerId` — the owner is the one person
 * allowed to see their own address. Never pass the result of this to a client
 * component prop, and never key any of these off an id that came from a form,
 * a param or a query string.
 *
 * `server-only` is imported for the same reason `app/lib/social/index.ts`
 * imports it: this module reaches the real connection, so a bundler pulling it
 * into a client chunk should be a build error rather than a leak.
 */

import "server-only";
import { cache } from "react";
import { auth } from "@/app/lib/auth";
import { getPlayerById, type Player } from "@/app/lib/players";
import { social } from "@/app/lib/social";
import { type BadgeStats } from "@/app/lib/badges";

/**
 * The signed-in player's id, or `null`.
 *
 * `session.user.playerId`, NEVER `session.user.id`: `app/lib/auth.ts` documents
 * that `user.id` is a fresh random UUID minted on every login, so keying any
 * read off it would make a returning player a stranger to their own account.
 */
export const readPlayerId = cache(async (): Promise<string | null> => {
  const session = await auth();
  return session?.user?.playerId ?? null;
});

/**
 * The signed-in player's server-side row, or `null` when nobody is signed in or
 * the row has vanished (never provisioned, or self-deleted in another tab).
 *
 * Both of those collapse to the same `null` on purpose: the safe, non-throwing
 * answer to "we cannot identify you" is "go and sign in again", and the caller
 * renders one card for both. Carries the email — see the module docblock.
 */
export const readPlayer = cache(async (): Promise<Player | null> => {
  const playerId = await readPlayerId();
  if (!playerId) return null;
  return getPlayerById(playerId);
});

/** The caller's own social row (username, friend code, public id), or `null`. */
export const readOwnSocial = cache(
  async (): Promise<Awaited<ReturnType<typeof social.getOwnSocial>>> => {
    const playerId = await readPlayerId();
    if (!playerId) return null;
    // Guarded on its own: before migration 007 the social columns do not exist,
    // and that must cost the username card, not the page around it.
    return social.getOwnSocial(playerId).catch(() => null);
  },
);

/**
 * The counts every badge rule is derived from, or `null` if they cannot be read.
 *
 * One query (see `social.badgeStats`), reused by the identity header's stat line
 * AND the Profile tab's badge shelf. Guarded on its own for the same reason as
 * the social row: badges come from tables that 007/008 create, and a missing
 * shelf must not 500 a page whose other sections are fine.
 */
export const readBadgeStats = cache(async (): Promise<BadgeStats | null> => {
  const playerId = await readPlayerId();
  if (!playerId) return null;
  return social.badgeStats(playerId).catch(() => null);
});
