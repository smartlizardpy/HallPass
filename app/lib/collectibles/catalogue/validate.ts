/**
 * Catalogue validation. Returns a list of problems (empty = valid) so a test can
 * print every one at once. Pure.
 */

import { RARITIES, type ArtStatus, type Catalogue, type Collectible, type Rarity } from "./types";

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ART_STATUS: ArtStatus[] = ["demo", "final"];

/** The cards a random slot over `pool` (a collection id) may roll: standard and not retired. */
export function eligibleCards(cat: Pick<Catalogue, "collectibles">, pool: string): Collectible[] {
  return cat.collectibles.filter((c) => c.collection === pool && c.pool === "standard" && !c.retired);
}

export function validateCatalogue(cat: Catalogue): string[] {
  const problems: string[] = [];
  const bad = (msg: string) => problems.push(msg);

  const collectionIds = new Set<string>();
  for (const col of cat.collections) {
    if (!ID_RE.test(col.id)) bad(`collection id "${col.id}" is not lowercase-kebab`);
    if (collectionIds.has(col.id)) bad(`duplicate collection id "${col.id}"`);
    collectionIds.add(col.id);
    if (!col.name.trim()) bad(`collection ${col.id} has no name`);
  }

  const byId = new Map<string, Collectible>();
  const numbers = new Map<string, number[]>();
  for (const c of cat.collectibles) {
    if (!ID_RE.test(c.id)) bad(`collectible id "${c.id}" is not lowercase-kebab`);
    if (byId.has(c.id)) bad(`duplicate collectible id "${c.id}"`);
    byId.set(c.id, c);
    if (!collectionIds.has(c.collection)) bad(`${c.id}: unknown collection "${c.collection}"`);
    if (!c.id.startsWith(`${c.collection}-`)) bad(`${c.id}: id must start with "${c.collection}-"`);
    if (!(RARITIES as readonly string[]).includes(c.rarity)) bad(`${c.id}: unknown rarity "${c.rarity}"`);
    const full = c.art.layout === "full";
    // A full-layout card's name and caption are part of its finished art, so only the name is required.
    if (!c.name.trim() || (!full && !c.caption.trim())) bad(`${c.id}: name${full ? "" : " and caption"} required`);
    if (c.caption.length > 120) bad(`${c.id}: caption is over 120 characters`);
    if (!ART_STATUS.includes(c.art.status)) bad(`${c.id}: art status must be demo or final`);
    if (full) {
      const re = (suffix: string) => new RegExp(`^/collectibles/${c.collection}/${c.id}${suffix}\\.[0-9a-f]{8}\\.webp$`);
      if (!re("").test(c.art.src)) bad(`${c.id}: full art.src must be /collectibles/${c.collection}/${c.id}.<hash>.webp`);
      if (!c.art.thumb || !re("-thumb").test(c.art.thumb)) bad(`${c.id}: full art.thumb must be /collectibles/${c.collection}/${c.id}-thumb.<hash>.webp`);
    } else if (c.art.src !== `/collectibles/${c.collection}/${c.id}.png`) bad(`${c.id}: art.src must be /collectibles/${c.collection}/${c.id}.png`);
    if (!c.art.alt.trim()) bad(`${c.id}: art.alt is required`);
    (numbers.get(c.collection) ?? numbers.set(c.collection, []).get(c.collection)!).push(c.number);
  }
  for (const [col, nums] of numbers) {
    const sorted = [...nums].sort((a, b) => a - b);
    if (sorted.some((n, i) => n !== i + 1)) bad(`collection ${col}: numbers must be 1..${nums.length} with no gaps or repeats`);
  }

  const packIds = new Set<string>();
  for (const p of cat.packs) {
    if (!ID_RE.test(p.id)) bad(`pack id "${p.id}" is not lowercase-kebab`);
    if (packIds.has(p.id)) bad(`duplicate pack id "${p.id}"`);
    packIds.add(p.id);
    if (!collectionIds.has(p.collection)) bad(`pack ${p.id}: unknown collection "${p.collection}"`);
    if (!p.versions.length) bad(`pack ${p.id}: no versions`);
    const latest = p.versions.length;
    p.versions.forEach((ver, i) => {
      const at = `pack ${p.id} v${ver.v}`;
      if (ver.v !== i + 1) bad(`${at}: versions must be numbered 1..n in order`);
      if (ver.size < 1 || ver.size !== ver.slots.length) bad(`${at}: size ${ver.size} does not match ${ver.slots.length} slots`);
      for (const [n, slot] of ver.slots.entries()) {
        if (slot.kind === "fixed") {
          const card = byId.get(slot.collectible);
          if (!card) bad(`${at} slot ${n + 1}: unknown collectible "${slot.collectible}"`);
        } else {
          if (!collectionIds.has(slot.pool)) {
            bad(`${at} slot ${n + 1}: unknown pool "${slot.pool}"`);
            continue;
          }
          const entries = Object.entries(slot.rarityWeights) as [Rarity, number][];
          const total = entries.reduce((sum, [, w]) => sum + w, 0);
          if (entries.some(([r, w]) => !RARITIES.includes(r) || !Number.isInteger(w) || w < 0)) bad(`${at} slot ${n + 1}: weights must be non-negative integers by known rarity`);
          if (total !== 100) bad(`${at} slot ${n + 1}: weights sum to ${total}, not 100`);
          // Earlier versions are published and immutable. A pool may have moved on since (cards retired):
          // the roller covers a sealed one (see roll.ts), so only the version new grants pin is held to this.
          for (const [r, w] of ver.v === latest ? entries : []) {
            if (w > 0 && !eligibleCards(cat, slot.pool).some((c) => c.rarity === r)) {
              bad(`${at} slot ${n + 1}: can roll ${r} but no eligible ${r} card exists in ${slot.pool}`);
            }
          }
        }
      }
    });
  }
  return problems;
}
