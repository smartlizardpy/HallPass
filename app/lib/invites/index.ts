/**
 * HallPass — the invites barrel: the live store bound to the shared Neon client,
 * the game resolver every invite surface shares, and fail-soft reads.
 *
 * Mirrors `challenges/index.ts`: the factory in `store.ts` stays testable against
 * a fake `sql`; THIS module reaches for the real connection, auth and the
 * including-staged catalogue, so it is the one that must never reach a client
 * bundle — and the ONLY invites file on the staged allowlist
 * (`app/lib/staged-allowlist.test.ts`). The route, the picker page and the
 * landing page all ask {@link resolveInviteGame} rather than the catalogue.
 *
 * READS ARE FAIL-SOFT, WRITES ARE NOT, for the reason `challenges/index.ts`
 * gives: schema here is applied by hand, so there is a window where this code
 * runs without a `game_invites` table. A read degrades (no friends to list, no
 * invite to show) and logs unless that window is the cause; a write throws, so
 * the route can tell "refused" from "down".
 */

import "server-only";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import type { Game } from "@/app/lib/games";
import { resolveGame, resolveGameIncludingStaged } from "@/app/lib/games-store";
import { isStaged } from "@/app/lib/game-staging";
import { canViewStaged } from "@/app/lib/beta/staged-access";
import { superAdminEmails } from "@/app/lib/notifications/admins";
import { createInviteStore, type InvitableFriend, type PublicInvite } from "./store";

/** The live store. Use it directly where errors must surface (writes). */
export const invites = createInviteStore(sql);

export type { FriendInviteOutcome, InvitableFriend, LinkOutcome, PublicInvite, SentInvite } from "./store";

/** A game an invite may name, and whether it is staged (which changes who may receive it). */
export type InviteGame = { game: Game; staged: boolean };

/**
 * The game for `slug` if the CURRENT REQUEST may invite people to it, else
 * `null`.
 *
 * A public game: always. A staged game: only when `canViewStaged()` — and a
 * denied staged slug returns `null` exactly like an unknown one, so no invite
 * surface can be used to learn that a staged game exists.
 *
 * The public resolver is asked FIRST so the common case never calls `auth()`
 * here (`canViewStaged()` documents why it must only run for staged slugs).
 */
export async function resolveInviteGame(slug: string): Promise<InviteGame | null> {
  try {
    const visible = await resolveGame(slug);
    if (visible) return { game: visible, staged: false };
    const hidden = await resolveGameIncludingStaged(slug);
    if (!hidden || !isStaged(hidden)) return null;
    return (await canViewStaged()) ? { game: hidden, staged: true } : null;
  } catch (error) {
    // Both resolvers fail soft already; this is belt and braces. Fail CLOSED.
    console.error("[invites] resolveInviteGame failed:", error);
    return null;
  }
}

/**
 * The super-admin emails that count as "can view staged games" when deciding
 * who may RECEIVE a staged invite — `canViewStaged()`'s rule for somebody other
 * than the caller. Re-exported so callers do not reach into notifications.
 */
export function stagedViewerAdminEmails(): string[] {
  return superAdminEmails();
}

function isExpectedMissingSchema(error: unknown): boolean {
  return isMissingColumnError(error) || isUnconfiguredDbError(error);
}

/** Log unless the failure is the expected missing-schema window. */
export function reportUnexpected(what: string, error: unknown): void {
  if (!isExpectedMissingSchema(error)) {
    console.error(`[invites] ${what} failed:`, error);
  }
}

/**
 * The friends this player may invite to the game, or `[]` on any failure. The
 * picker still offers "Share link" when this is empty.
 */
export async function getInvitableFriends(me: string, target: InviteGame): Promise<InvitableFriend[]> {
  try {
    return await invites.listInvitableFriends({
      me,
      slug: target.game.slug,
      stagedOnly: target.staged,
      adminEmails: target.staged ? stagedViewerAdminEmails() : [],
    });
  } catch (error) {
    reportUnexpected("listInvitableFriends", error);
    return [];
  }
}

/** The invite behind a code, or `null` when unknown, collected, or unreadable. */
export async function getInvite(code: string): Promise<PublicInvite | null> {
  try {
    return await invites.getByCode(code);
  } catch (error) {
    reportUnexpected("getByCode", error);
    return null;
  }
}
