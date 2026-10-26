/**
 * HallPass pack opening — the pure parts: timings, the tear gesture, the words.
 *
 * HONEST PRESENTATION (docs/collectibles-design.md §5). The pack's contents are
 * decided by the server BEFORE any of this runs; the animation only shows them.
 * Rarity changes the length of the flip and a short hold before it, the same
 * for every player and every opening: no near-miss slowdowns, no fake tells.
 */

import { getCollectible } from "./catalogue";
import type { PackVersion, Rarity } from "./catalogue/types";
import { RARITY_LABEL } from "./present";

/** Flip length by rarity (450-800 ms). */
export const FLIP_MS: Record<Rarity, number> = { common: 450, uncommon: 500, rare: 600, epic: 700, legendary: 800 };
/** Pause before the flip, while the true-rarity glow builds. */
export const HOLD_MS: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 150, epic: 300, legendary: 600 };
/** Cards slide out of the pack one after another. */
export const EMERGE = { staggerMs: 120, eachMs: 350 } as const;

/**
 * The tear. Forgiving on purpose: a drag counts while it stays within 35° of the
 * seal; it commits at 60 % of the seal's width or on a flick, and otherwise
 * springs back. Keyboard and the Tear button skip the gesture entirely.
 */
export const TEAR = { coneDeg: 35, commitAt: 0.6, flickPxPerMs: 0.9, completeMs: 200 } as const;

export interface TearSample {
  x: number;
  y: number;
  t: number;
}

/** Progress 0-1 along the seal from where the drag began, in either direction. Off-cone movement makes no progress. */
export function tearProgress(start: TearSample, now: TearSample, sealWidth: number): { progress: number; inCone: boolean } {
  const dx = now.x - start.x;
  const dy = now.y - start.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 4) return { progress: 0, inCone: true };
  const angle = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  const inCone = angle <= TEAR.coneDeg;
  const width = Math.max(1, sealWidth);
  return { progress: inCone ? Math.min(1, Math.abs(dx) / width) : 0, inCone };
}

/** Whether a released drag tears the pack: far enough, or fast enough along the seal. */
export function tearCommits(progress: number, prev: TearSample | null, last: TearSample | null): boolean {
  if (progress >= TEAR.commitAt) return true;
  if (!prev || !last || last.t <= prev.t) return false;
  const speed = Math.abs(last.x - prev.x) / (last.t - prev.t);
  return progress > 0.15 && speed >= TEAR.flickPxPerMs;
}

/** "Card 2 of 3: Rare, The Caretaker, new." for the live region. */
export function revealLine(index: number, total: number, collectibleId: string, wasNew: boolean): string {
  const card = getCollectible(collectibleId);
  if (!card) return `Card ${index} of ${total}.`;
  return `Card ${index} of ${total}: ${RARITY_LABEL[card.rarity]}, ${card.name}, ${wasNew ? "new" : "duplicate"}.`;
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
