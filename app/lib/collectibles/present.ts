/**
 * HallPass Collectibles — presentation facts derived from the catalogue. Pure
 * and client-safe (no `roll.ts`, no crypto), so components may import it.
 */

import { cardsIn, getCollection, getPack } from "./catalogue";
import type { Collectible, Rarity } from "./catalogue/types";

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

/** 1 (common) to 5 (legendary): the pip count, and the sort order. */
export const RARITY_RANK: Record<Rarity, number> = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };

/**
 * The art's native size. Common and uncommon art is 32×32, everything rarer
 * 48×48 (public/collectibles/ART.md; the catalogue test checks the files), so
 * a component can draw it at a whole-number scale and keep every pixel square.
 */
export function artPixels(card: Pick<Collectible, "rarity">): 32 | 48 {
  return card.rarity === "common" || card.rarity === "uncommon" ? 32 : 48;
}

/** "07/20": the card's number within its collection. */
export function cardNumber(card: Pick<Collectible, "collection" | "number">): string {
  const total = cardsIn(card.collection).length;
  const width = String(total).length;
  return `${String(card.number).padStart(width, "0")}/${total}`;
}

/** The collection's theme colours, with safe fallbacks. */
export function collectionColours(collectionId: string): { base: string; accent: string; light: string } {
  const c = getCollection(collectionId)?.theme.colours ?? [];
  return { base: c[0] ?? "#23153a", accent: c[1] ?? "#ffd84a", light: c[2] ?? "#fff8e7" };
}

/** Plain words for screen readers: "The Caretaker. Epic card, number 14 of 20 in Fright Fest 2026." */
export function cardLabel(card: Collectible): string {
  const collection = getCollection(card.collection)?.name ?? card.collection;
  return `${card.name}. ${RARITY_LABEL[card.rarity]} ${card.kind}, number ${card.number} of ${cardsIn(card.collection).length} in ${collection}.`;
}

/** The wrapper a pack is drawn in (its collection's), and its emblem. */
export function packLook(packId: string): { wrapper: string; collection: string; name: string } | null {
  const pack = getPack(packId);
  if (!pack) return null;
  return { wrapper: pack.wrapper, collection: pack.collection, name: pack.name };
}
