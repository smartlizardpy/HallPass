/**
 * HallPass — Hall Tokens: THE ONE PLACE TO EDIT the economy's numbers.
 *
 * Hall Tokens are the permanent, year-round currency (Halloween Candy is the
 * Fright Fest-only one, `app/lib/candy`). Every amount here is a single number
 * changed by commit; the ledger stores what was actually paid, so a change never
 * re-prices a past row.
 *
 * EARNING. A signed-in player's play is recorded by the server
 * (`/api/v1/me/plays`, which validates the slug against the catalogue), never by
 * the client claiming a number. What stops farming is the caps, not a playtime
 * measurement the browser could forge: tokens per distinct game per UK day, and a
 * daily ceiling.
 *
 * MARKET. Only the permanent sets' standard packs are for sale; the Fright Fest
 * packs and the candy-only Rare packs are not.
 */

import type { Rarity } from "../collectibles/catalogue/types";

export const PLAY_TOKENS = 5;
export const DAILY_PLAY_CAP = 30;
/** A streak of 2+ days pays `min(streak, STREAK_BONUS_MAX_DAYS) * STREAK_TOKENS_PER_DAY` once per UK day. */
export const STREAK_TOKENS_PER_DAY = 2;
export const STREAK_BONUS_MAX_DAYS = 10;

/** Token price per market pack. Absent = not for sale. */
export const MARKET_PRICES: Readonly<Record<string, number>> = {
  "legends-standard": 100,
  "brainrot-standard": 100,
  "turkish-standard": 100,
  "gaming-standard": 100,
};

/** What a card is worth at full price; selling a duplicate back pays `SELL_BACK_PCT` of it. */
export const CARD_BASE_VALUE: Readonly<Record<Rarity, number>> = {
  common: 10,
  uncommon: 20,
  rare: 50,
  epic: 120,
  legendary: 400,
};
export const SELL_BACK_PCT = 20;

export function sellBackValue(rarity: Rarity): number {
  return Math.floor((CARD_BASE_VALUE[rarity] * SELL_BACK_PCT) / 100);
}

export function streakBonus(streak: number): number {
  return streak >= 2 ? Math.min(streak, STREAK_BONUS_MAX_DAYS) * STREAK_TOKENS_PER_DAY : 0;
}

/** The UK calendar day (`YYYY-MM-DD`) of an instant: what "per day" means for caps and keys. */
export function ukDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
