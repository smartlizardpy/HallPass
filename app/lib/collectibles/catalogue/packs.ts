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
  ],
});

const standardPack = (collection: string, name: string, wrapper: string): Pack => ({
  id: `${collection}-standard`,
  collection,
  name: `${name} Pack`,
  description: `Three stickers or cards from ${name}.`,
  wrapper,
  versions: [
    { v: 1, size: 3, slots: [random(collection, ODDS.standard), random(collection, ODDS.standard), random(collection, ODDS.standard)] },
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
    ],
  },
  championPack("last-bell", "Last Bell"),
  championPack("shadow-core", "Shadow Core"),
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
    ],
  },
  standardPack("hpo", "HallPass Originals", "hall-pass-tag"),
  standardPack("inet", "Internet Culture", "browser-sleeve"),
  standardPack("brr", "Brainrot", "snack-sachet"),
  standardPack("tr", "Turkish Internet Culture", "tea-box"),
];
