/**
 * Collection progress from a binder. Pure: derived from the ledger on every read,
 * never stored, so it cannot drift (docs/collectibles-design.md §3).
 */

import { CATALOGUE } from "./catalogue";
import type { BinderEntry } from "./store";

export interface CollectionProgress {
  collection: string;
  owned: number;
  total: number;
  /** Whole percent, 0 to 100. */
  percent: number;
}

/** Distinct cards owned per collection, against every card the collection has. */
export function collectionProgress(binder: ReadonlyArray<Pick<BinderEntry, "collectibleId">>): CollectionProgress[] {
  const ownedIds = new Set(binder.map((b) => b.collectibleId));
  return [...CATALOGUE.collections]
    .sort((a, b) => a.sort - b.sort)
    .map((col) => {
      const cards = CATALOGUE.collectibles.filter((c) => c.collection === col.id);
      const owned = cards.filter((c) => ownedIds.has(c.id)).length;
      return { collection: col.id, owned, total: cards.length, percent: cards.length ? Math.floor((owned / cards.length) * 100) : 0 };
    });
}
