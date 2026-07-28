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
import { createSocialStore } from "./store";

export const social = createSocialStore(sql);

export type { PublicProfile, FriendRequest, SendResult } from "./store";
