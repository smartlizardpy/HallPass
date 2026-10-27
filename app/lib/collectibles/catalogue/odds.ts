/**
 * The published odds tables (docs/collectibles-design.md §2). Percent, integers,
 * each summing to 100. Within a rarity every eligible card is equally likely.
 *
 * Packs copy these values into their slots rather than referencing them, so a
 * published pack version is fully described by its own data (and its lock hash).
 * Editing a number here changes NOTHING already published; it only affects packs
 * written afterwards, and the lock test catches an accidental edit.
 */

import type { RarityWeights } from "./types";

export const ODDS = {
  standard: { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 },
  rareOrBetter: { rare: 75, epic: 20, legendary: 5 },
  epicOrBetter: { epic: 80, legendary: 20 },
  // Pools that have no card in a tier move that tier's weight to the next tier down
  // (reviewed 27 Oct 2026; see docs/collectibles-catalogue-import.md). Not used by v1 packs.
  standardNoEpic: { common: 60, uncommon: 25, rare: 14, legendary: 1 },
  rareOrBetterNoEpic: { rare: 95, legendary: 5 },
  standardNoLegendary: { common: 60, uncommon: 25, rare: 10, epic: 5 },
  rareOrBetterNoLegendary: { rare: 75, epic: 25 },
  epicOrBetterNoLegendary: { epic: 100 },
} as const satisfies Record<string, RarityWeights>;
