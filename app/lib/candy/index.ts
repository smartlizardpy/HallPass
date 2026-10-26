/**
 * HallPass — the Candy Hunt barrel: the live store bound to the shared Neon
 * client, and the read every surface uses.
 *
 * Mirrors `collectibles/index.ts`: the factory stays testable with a fake `sql`;
 * this module holds the real connection, so it is `server-only`.
 *
 * FAIL-SOFT READS. Migration 050 is applied by hand, so this code can be live
 * against a database without the candy tables. `getMyCandy` then says
 * `available: false` (the UI shows "unavailable") instead of 500ing. A failed
 * SYNC alone (a transient error) does not hide the balance. WRITES are not
 * softened: a spend that fails must say so.
 */

import "server-only";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import { resolveGames } from "@/app/lib/games-store";
import { CANDY_FRIGHT_FEST_2026 } from "./fright-fest-2026";
import { describeEntry, gamePayouts, shopItems, type GamePayout, type RecentEntry, type ShopItem } from "./present";
import { createCandyStore } from "./store";

export const candyStore = createCandyStore(sql);
export const CANDY = CANDY_FRIGHT_FEST_2026;

function expected(error: unknown): boolean {
  return isMissingColumnError(error) || isUnconfiguredDbError(error);
}

/** The payout per game (public data). Fail-soft like the rest: no candy column yet, or no database, reads as an empty list. */
export async function getGamePayouts(): Promise<GamePayout[]> {
  try {
    const boards = await candyStore.payingBoards();
    const titles = new Map<string, string>();
    for (const g of await resolveGames()) titles.set(g.slug, g.title);
    return gamePayouts(boards, titles);
  } catch (error) {
    if (!expected(error)) console.error("candy.getGamePayouts failed; reading none:", error);
    return [];
  }
}

export interface MyCandy {
  available: boolean;
  balance: number;
  /** What THIS call's sync paid: 0 on a repeat. */
  newlyCredited: { count: number; amount: number };
  recent: RecentEntry[];
  shop: ShopItem[];
}

const UNAVAILABLE: MyCandy = { available: false, balance: 0, newlyCredited: { count: 0, amount: 0 }, recent: [], shop: shopItems(0) };

/** Sync, then read one player's balance, recent ledger and shelf. Never throws. */
export async function getMyCandy(playerId: string): Promise<MyCandy> {
  let newly = { count: 0, amount: 0 };
  try {
    const r = await candyStore.sync(playerId);
    newly = { count: r.credited, amount: r.amount };
  } catch (error) {
    if (!expected(error)) console.error("candy.sync failed; reading without it:", error);
  }
  try {
    const [balance, history] = await Promise.all([candyStore.balance(playerId), candyStore.history(playerId, 25)]);
    const titles = new Map<string, string>();
    if (history.some((h) => h.kind === "daily_best" && h.gameSlug)) {
      for (const g of await resolveGames()) titles.set(g.slug, g.title);
    }
    return {
      available: true,
      balance,
      newlyCredited: newly,
      recent: history.map((h) => describeEntry(h, titles)),
      shop: shopItems(balance),
    };
  } catch (error) {
    if (!expected(error)) console.error("candy.getMyCandy failed; degrading:", error);
    return UNAVAILABLE;
  }
}
