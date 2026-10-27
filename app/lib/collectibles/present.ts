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
export function cardNumber(card: Pick<Collectible, "collection" | "number" | "retired">): string {
  const { position, total } = setPosition(card);
  const width = String(total).length;
  return `${String(position).padStart(width, "0")}/${total}`;
}

/**
 * Where a card sits in its set. Rows are never renumbered, so a collection that replaced its art
 * has retired rows with gaps in `number`: a current card is counted among the cards still in the set,
 * a retired one keeps its own number out of every row the collection has.
 */
function setPosition(card: Pick<Collectible, "collection" | "number" | "retired">): { position: number; total: number } {
  const all = cardsIn(card.collection);
  if (card.retired) return { position: card.number, total: all.length };
  const current = all.filter((c) => !c.retired);
  return { position: current.filter((c) => c.number <= card.number).length, total: current.length };
}

/** The collection's theme colours, with safe fallbacks. */
export function collectionColours(collectionId: string): { base: string; accent: string; light: string } {
  const c = getCollection(collectionId)?.theme.colours ?? [];
  return { base: c[0] ?? "#23153a", accent: c[1] ?? "#ffd84a", light: c[2] ?? "#fff8e7" };
}

/** Plain words for screen readers: "The Caretaker. Epic card, number 14 of 20 in Fright Fest 2026." */
export function cardLabel(card: Collectible): string {
  const collection = getCollection(card.collection)?.name ?? card.collection;
  const { position, total } = setPosition(card);
  return `${card.name}. ${RARITY_LABEL[card.rarity]} ${card.kind}, number ${position} of ${total} in ${collection}.`;
}

/** The wrapper a pack is drawn in (its collection's), and its emblem. */
export function packLook(packId: string): { wrapper: string; collection: string; name: string } | null {
  const pack = getPack(packId);
  if (!pack) return null;
  return { wrapper: pack.wrapper, collection: pack.collection, name: pack.name };
}
