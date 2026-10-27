/**
 * The launch packs (docs/collectibles-design.md §2). Versions are IMMUTABLE once
 * published: to change contents or odds, append a new version; never edit one.
 * `catalogue.lock.json` and its test enforce it.
 */

import { ODDS } from "./odds";
import type { Pack, RarityWeights, Slot } from "./types";

const fixed = (collectible: string): Slot => ({ kind: "fixed", collectible });
const random = (pool: string, rarityWeights: RarityWeights): Slot => ({
  kind: "random",
  pool,
  rarityWeights: { ...rarityWeights },
});

/**
 * Fright Fest v2 (27 Oct 2026): the curated set has no droppable Legendary, so every random slot
 * moves that weight down a tier (ODDS.*NoLegendary). The v1 rows are kept byte for byte.
 */
const championPack = (game: string, name: string): Pack => ({
  id: `ff26-winner-${game}`,
  collection: "ff26",
  name: `${name} Champion Pack`,
  description: `Awarded to the finalised winner of the ${name} board.`,
  wrapper: "prize-bag",
  versions: [
    {
      v: 1,
      size: 3,
      slots: [fixed(`ff26-champion-${game}`), random("ff26", ODDS.rareOrBetter), random("ff26", ODDS.standard)],
    },
    {
      v: 2,
      size: 3,
      slots: [fixed(`ff26-champion-${game}`), random("ff26", ODDS.rareOrBetterNoLegendary), random("ff26", ODDS.standardNoLegendary)],
    },
  ],
});

interface PoolOdds {
  standard: RarityWeights;
  rareOrBetter: RarityWeights;
}
const FULL_ODDS: PoolOdds = { standard: ODDS.standard, rareOrBetter: ODDS.rareOrBetter };

const standardPack = (collection: string, name: string, wrapper: string, odds: PoolOdds = FULL_ODDS): Pack => ({
  id: `${collection}-standard`,
  collection,
  name: `${name} Pack`,
  description: `Three stickers or cards from ${name}.`,
  wrapper,
  versions: [
    { v: 1, size: 3, slots: [random(collection, odds.standard), random(collection, odds.standard), random(collection, odds.standard)] },
  ],
});

/**
 * The Rare pack, bought with Halloween Candy (docs/candy-hunt.md): slot 1 is a
 * standard roll, slots 2 and 3 are each rare-or-better. Existing odds tables only.
 */
const rarePack = (collection: string, name: string, wrapper: string, odds: PoolOdds = FULL_ODDS): Pack => ({
  id: `${collection}-rare`,
  collection,
  name: `${name} Rare Pack`,
  description: `Bought with Halloween Candy. Three cards from ${name}: one at the usual odds, two rare or better.`,
  wrapper,
  versions: [
    { v: 1, size: 3, slots: [random(collection, odds.standard), random(collection, odds.rareOrBetter), random(collection, odds.rareOrBetter)] },
  ],
});

export const PACKS: Pack[] = [
  {
    id: "ff26-participation",
    collection: "ff26",
    name: "Fright Fest Participation Pack",
    description: "Awarded for an accepted result on every board in the Fright Fest lineup.",
    wrapper: "prize-bag",
    versions: [
      { v: 1, size: 3, slots: [fixed("ff26-survivor"), random("ff26", ODDS.standard), random("ff26", ODDS.standard)] },
      { v: 2, size: 3, slots: [fixed("ff26-survivor"), random("ff26", ODDS.standardNoLegendary), random("ff26", ODDS.standardNoLegendary)] },
    ],
  },
  championPack("last-bell", "Last Bell"),
  championPack("shadow-core", "Shadow Core"),
  championPack("scp-lockdown", "SCP: Lockdown"),
  championPack("survive-till-dawn", "Survive Till Dawn"),
  {
    id: "ff26-overall-winner",
    collection: "ff26",
    name: "Fright Fest Overall Champion Pack",
    description: "Awarded to the top eligible player of Fright Fest 2026.",
    wrapper: "prize-bag",
    versions: [
      {
        v: 1,
        size: 3,
        slots: [fixed("ff26-overall-champion"), fixed("ff26-the-last-bell"), random("ff26", ODDS.epicOrBetter)],
      },
      // v2: the Golden Ticket plus two epics. The demo Last Bell card of v1 is retired; the curated set
      // has no other legendary to give, so the two other slots roll the epic-only table.
      {
        v: 2,
        size: 3,
        slots: [fixed("ff26-overall-champion"), random("ff26", ODDS.epicOrBetterNoLegendary), random("ff26", ODDS.epicOrBetterNoLegendary)],
      },
    ],
  },
  standardPack("hpo", "HallPass Originals", "hall-pass-tag"),
  standardPack("inet", "Internet Culture", "browser-sleeve"),
  standardPack("brr", "Brainrot", "snack-sachet"),
  standardPack("tr", "Turkish Internet Culture", "tea-box"),
  rarePack("hpo", "HallPass Originals", "hall-pass-tag"),
  rarePack("inet", "Internet Culture", "browser-sleeve"),
  rarePack("brr", "Brainrot", "snack-sachet"),
  rarePack("tr", "Turkish Internet Culture", "tea-box"),
  // The curated permanent sets. A pool with no card in a tier moves that weight to the next tier down.
  standardPack("legends", "Internet Legends", "browser-sleeve", { standard: ODDS.standardNoEpic, rareOrBetter: ODDS.rareOrBetterNoEpic }),
  standardPack("brainrot", "Brainrot & Reactions", "snack-sachet", { standard: ODDS.standardNoLegendary, rareOrBetter: ODDS.rareOrBetterNoLegendary }),
  standardPack("turkish", "Turkish Internet", "tea-box"),
  standardPack("gaming", "Gaming Legends", "hall-pass-tag", { standard: ODDS.standardNoLegendary, rareOrBetter: ODDS.rareOrBetterNoLegendary }),
  rarePack("legends", "Internet Legends", "browser-sleeve", { standard: ODDS.standardNoEpic, rareOrBetter: ODDS.rareOrBetterNoEpic }),
  rarePack("brainrot", "Brainrot & Reactions", "snack-sachet", { standard: ODDS.standardNoLegendary, rareOrBetter: ODDS.rareOrBetterNoLegendary }),
  rarePack("turkish", "Turkish Internet", "tea-box"),
  rarePack("gaming", "Gaming Legends", "hall-pass-tag", { standard: ODDS.standardNoLegendary, rareOrBetter: ODDS.rareOrBetterNoLegendary }),
].map((p) => (["hpo", "inet", "brr", "tr"].includes(p.collection) ? { ...p, closed: true as const } : p));
