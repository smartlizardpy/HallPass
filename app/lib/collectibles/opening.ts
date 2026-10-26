/**
 * HallPass pack opening — the words: what is read out as each card is turned
 * over, and what a pack holds, printed with its published odds.
 *
 * HONEST PRESENTATION (docs/collectibles-design.md §5). The pack's contents are
 * decided by the server BEFORE the opening plays; the animation only shows them.
 * Timing never depends on rarity before a card's face is showing (the tear and
 * the turn are in `app/components/collectibles/opening/`).
 */

import { getCollectible } from "./catalogue";
import type { PackVersion, Rarity } from "./catalogue/types";
import { RARITY_LABEL } from "./present";

/** "Card 2 of 3: Rare, The Caretaker, new for your binder." for the live region. */
export function revealLine(index: number, total: number, collectibleId: string, wasNew: boolean): string {
  const card = getCollectible(collectibleId);
  if (!card) return `Card ${index} of ${total}.`;
  return `Card ${index} of ${total}: ${RARITY_LABEL[card.rarity]}, ${card.name}, ${wasNew ? "new for your binder" : "already in your binder"}.`;
}

/**
 * What a pack version holds, in words, for the back of the pack: fixed cards by
 * name, and each run of identical chance slots as one line with its published
 * odds ("Cards 2-3: Common 60%, Uncommon 25%, ...").
 */
export function slotLines(version: PackVersion): string[] {
  const lines: string[] = [];
  let i = 0;
  while (i < version.slots.length) {
    const slot = version.slots[i];
    let j = i + 1;
    if (slot.kind === "random") {
      const key = JSON.stringify([slot.pool, slot.rarityWeights]);
      while (j < version.slots.length) {
        const next = version.slots[j];
        if (next.kind !== "random" || JSON.stringify([next.pool, next.rarityWeights]) !== key) break;
        j++;
      }
    }
    const label = j - i > 1 ? `Cards ${i + 1}–${j}` : `Card ${i + 1}`;
    if (slot.kind === "fixed") {
      lines.push(`${label}: ${getCollectible(slot.collectible)?.name ?? slot.collectible}, always`);
    } else {
      const odds = (Object.keys(RARITY_LABEL) as Rarity[])
        .filter((r) => (slot.rarityWeights[r] ?? 0) > 0)
        .map((r) => `${RARITY_LABEL[r]} ${slot.rarityWeights[r]}%`)
        .join(", ");
      lines.push(`${label}: ${odds}`);
    }
    i = j;
  }
  return lines;
}
