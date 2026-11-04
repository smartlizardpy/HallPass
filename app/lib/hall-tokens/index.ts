/**
 * HallPass — Hall Tokens: the live store bound to the shared Neon client, and the
 * fail-soft read the Market and the beacon use. Mirrors `candy/index.ts`.
 *
 * Migration 053 is applied by hand, so this can be live against a database
 * without `token_ledger`. Reads then say `available: false`; WRITES are not
 * softened (a purchase that fails must say so).
 */

import "server-only";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import { MARKET_PRICES, SELL_BACK_PCT, ukDay } from "./config";
import { createHallTokensStore } from "./store";

export const hallTokens = createHallTokensStore(sql);

function expected(error: unknown): boolean {
  return isMissingColumnError(error) || isUnconfiguredDbError(error);
}

export interface MyTokens {
  available: boolean;
  balance: number;
  recent: { amount: number; kind: string; ref: string | null; at: string }[];
  market: { packId: string; price: number }[];
  sellBackPct: number;
}

/** One player's wallet. Never throws. */
export async function getMyTokens(playerId: string): Promise<MyTokens> {
  const market = Object.entries(MARKET_PRICES).map(([packId, price]) => ({ packId, price }));
  try {
    const [balance, recent] = await Promise.all([hallTokens.balance(playerId), hallTokens.history(playerId)]);
    return { available: true, balance, recent, market, sellBackPct: SELL_BACK_PCT };
  } catch (error) {
    if (!expected(error)) console.error("hall-tokens.getMyTokens failed; degrading:", error);
    return { available: false, balance: 0, recent: [], market, sellBackPct: SELL_BACK_PCT };
  }
}

/** Credit a play, fail-soft: a token problem must never break the play beacon. */
export async function earnForPlay(playerId: string, slug: string): Promise<void> {
  try {
    await hallTokens.earnForPlay(playerId, slug, ukDay());
  } catch (error) {
    if (!expected(error)) console.error("hall-tokens.earnForPlay failed:", error);
  }
}
