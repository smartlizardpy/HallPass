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
} as const satisfies Record<string, RarityWeights>;
