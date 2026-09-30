/**
 * HallPass — the social barrel: the live store bound to the shared Neon client.
 *
 * Mirrors `app/lib/scoreboard/index.ts`. The factory in `store.ts` stays free of
 * `server-only` so it can be unit-tested with a fake tagged template; THIS module
 * is the one that reaches for the real connection, so it is the one that must not
 * reach a client bundle.
 */

import "server-only";
import { sql } from "@/app/lib/db";
import { stagedSlugs } from "@/app/lib/games-store";
import { createSocialStore } from "./store";

const store = createSocialStore(sql);

/**
 * The live store, with `badgeStats` bound to EXCLUDE staged games' achievement
 * points. Badges are public (`/u/<username>`), and a tester's points on a
 * beta-only game must not be visible before it is published; binding it here
 * means no caller can forget. Every other method is the store's own.
 */
export const social = {
  ...store,
  badgeStats: async (playerId: string) =>
    store.badgeStats(playerId, await stagedSlugs()),
};

export type { PublicProfile, FriendRequest, SendResult } from "./store";
