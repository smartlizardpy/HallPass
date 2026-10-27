/**
 * Rolling a pack's contents. Server-only in practice (it defaults to the node
 * crypto RNG), pure given an injected `randomInt`.
 *
 * `crypto.randomInt` is rejection-sampled, so there is no modulo bias. A slot
 * draws a rarity by its integer percent weights, then a card uniformly among
 * the eligible cards of that rarity. Odds never depend on the player.
 */

import { randomInt as cryptoRandomInt } from "node:crypto";
import { eligibleCards } from "./validate";
import { RARITIES, type Catalogue, type PackVersion, type Rarity, type Slot } from "./types";

/** Returns an integer in [0, max). */
export type RandomInt = (max: number) => number;

export function rollSlot(cat: Pick<Catalogue, "collectibles">, slot: Slot, randomInt: RandomInt): string {
  if (slot.kind === "fixed") return slot.collectible;
  const roll = randomInt(100);
  let acc = 0;
  let rarity: Rarity | null = null;
  for (const r of RARITIES) {
    const w = slot.rarityWeights[r] ?? 0;
    if (w <= 0) continue;
    acc += w;
    if (roll < acc) {
      rarity = r;
      break;
    }
  }
  if (!rarity) throw new Error("rarity weights do not sum to 100");
  const pool = eligibleCards(cat, slot.pool);
  // Every pack version new grants pin is validated to have a card for each rarity it can roll. A
  // SEALED copy of an older version can meet a pool that has since lost a tier (its cards retired):
  // it rolls the nearest lower tier that has cards, then the nearest higher, so it always opens.
  const order = [...RARITIES.slice(0, RARITIES.indexOf(rarity) + 1).reverse(), ...RARITIES.slice(RARITIES.indexOf(rarity) + 1)];
  for (const r of order) {
    const cards = pool.filter((c) => c.rarity === r);
    if (cards.length) return cards[randomInt(cards.length)].id;
  }
  throw new Error(`no eligible card in ${slot.pool}`);
}

/** One collectible id per slot, in slot order. */
export function rollPack(cat: Pick<Catalogue, "collectibles">, version: PackVersion, randomInt: RandomInt = cryptoRandomInt): string[] {
  return version.slots.map((s) => rollSlot(cat, s, randomInt));
}
