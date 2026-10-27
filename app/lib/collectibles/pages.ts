/**
 * HallPass Collectibles — pure helpers behind the player pages (the binder, the
 * Pack Room, the public card page). No IO and no `roll.ts`, so client islands
 * and static pages may both import it.
 */

import { CATALOGUE, currentVersion, eligibleCards, getCollection, RARITIES } from "./catalogue";
import type { Collectible, Pack, Rarity, RarityWeights, Slot } from "./catalogue/types";
import type { CollectionProgress } from "./progress";
import { RARITY_LABEL } from "./present";

/** The slice of a binder entry the view needs (the wire shape of `BinderEntry`). */
export interface OwnedEntry {
  collectibleId: string;
  owned: number;
  firstPulledAt: string;
  favourite: boolean;
  featuredPosition: number | null;
  isNew: boolean;
}

export interface BinderFilters {
  collection: string | "all";
  rarity: Rarity | "all";
}

export interface BinderCell {
  card: Collectible;
  entry: OwnedEntry | null;
}

export interface BinderGroup {
  collection: string;
  name: string;
  progress: CollectionProgress;
  /** Card-number order (retired cards a player still owns last), after the rarity filter. */
  cells: BinderCell[];
}

/** "12 of 20 · 60%". */
export function formatProgress(p: Pick<CollectionProgress, "owned" | "total" | "percent">): string {
  return `${p.owned} of ${p.total} · ${p.percent}%`;
}

/**
 * Groups the whole catalogue by collection (progress order, which is the
 * catalogue's `sort`), cards in number order, owned ones paired with their entry.
 * Progress always counts the whole collection; the rarity filter only hides cells.
 */
export function binderGroups(binder: readonly OwnedEntry[], progress: readonly CollectionProgress[], filters: BinderFilters): BinderGroup[] {
  const byId = new Map(binder.map((b) => [b.collectibleId, b]));
  return progress
    .filter((p) => filters.collection === "all" || p.collection === filters.collection)
    .map((p) => ({
      collection: p.collection,
      name: getCollection(p.collection)?.name ?? p.collection,
      progress: p,
      // A retired card (the old demo art) shows only to the people who own it.
      cells: CATALOGUE.collectibles
        .filter((c) => c.collection === p.collection && (!c.retired || byId.has(c.id)) && (filters.rarity === "all" || c.rarity === filters.rarity))
        .sort((a, b) => Number(!!a.retired) - Number(!!b.retired) || a.number - b.number)
        .map((card) => ({ card, entry: byId.get(card.id) ?? null })),
    }));
}

/** Ids of the cards still marked NEW, for the "seen" call. */
export function newIds(binder: readonly Pick<OwnedEntry, "collectibleId" | "isNew">[]): string[] {
  return binder.filter((b) => b.isNew).map((b) => b.collectibleId);
}

export function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Slots 1 to `max`, each with the card id that holds it (or null). */
export function freeSlots(binder: readonly Pick<OwnedEntry, "collectibleId" | "featuredPosition">[], max: number): { slot: number; heldBy: string | null }[] {
  return Array.from({ length: max }, (_, i) => {
    const slot = i + 1;
    return { slot, heldBy: binder.find((b) => b.featuredPosition === slot)?.collectibleId ?? null };
  });
}

/** "60% common, 25% uncommon, ..." in rarity order, only the rarities with a weight. */
export function formatOdds(weights: RarityWeights): { rarity: Rarity; label: string; percent: number }[] {
  return RARITIES.flatMap((r) => (weights[r] ? [{ rarity: r, label: RARITY_LABEL[r], percent: weights[r] as number }] : []));
}

export interface SlotView {
  n: number;
  kind: "fixed" | "random";
  /** Fixed slots: the card. */
  card?: Collectible;
  /** Random slots: the collection it draws from, and its odds. */
  pool?: string;
  poolName?: string;
  odds?: { rarity: Rarity; label: string; percent: number }[];
}

export interface PackView {
  pack: Pack;
  version: number;
  slots: SlotView[];
}

function slotView(slot: Slot, n: number): SlotView {
  if (slot.kind === "fixed") return { n, kind: "fixed", card: CATALOGUE.collectibles.find((c) => c.id === slot.collectible) };
  return { n, kind: "random", pool: slot.pool, poolName: getCollection(slot.pool)?.name ?? slot.pool, odds: formatOdds(slot.rarityWeights) };
}

/** Every pack with its CURRENT version's slots, for "What's in each pack". */
export function packViews(): PackView[] {
  return CATALOGUE.packs.filter((p) => !p.closed).map((pack) => {
    const v = currentVersion(pack);
    return { pack, version: v.v, slots: v.slots.map((s, i) => slotView(s, i + 1)) };
  });
}

/** One run of a slot's sentence. `as` tells the component what to dress it as; the text is the whole truth. */
export interface SlotPart {
  text: string;
  as?: "card" | "rarity" | "pool" | "odds";
}

/** "60% common, 25% uncommon, ...": the published odds of a random slot, in words. */
export function oddsText(odds: readonly { label: string; percent: number }[]): string {
  return odds.map((o) => `${o.percent}% ${o.label.toLowerCase()}`).join(", ");
}

/**
 * A slot's sentence as runs, so the component can style the card, rarity, pool
 * and odds while the words stay in ONE place. Joined, the runs read exactly:
 * "Always <card> (<rarity>)." or "One card from <pool>: 60% common, ....".
 * This is the published odds disclosure: change it only with the catalogue.
 */
export function slotParts(s: SlotView): SlotPart[] {
  if (s.kind === "fixed" && s.card) {
    return [
      { text: "Always " },
      { text: s.card.name, as: "card" },
      { text: " (" },
      { text: RARITY_LABEL[s.card.rarity].toLowerCase(), as: "rarity" },
      { text: ")." },
    ];
  }
  return [
    { text: "One card from " },
    { text: s.poolName ?? "", as: "pool" },
    { text: ": " },
    { text: oddsText(s.odds ?? []), as: "odds" },
    { text: "." },
  ];
}

/** The slot's full line as plain text, "Slot 1. Always ...". */
export function slotLine(s: SlotView): string {
  return `Slot ${s.n}. ${slotParts(s).map((p) => p.text).join("")}`;
}

export interface PackGroup {
  /** The collection id for an event's packs, or "everyday". */
  id: string;
  title: string;
  packs: PackView[];
}

/**
 * The packs under their subheadings, from catalogue data: a pack whose
 * collection is an `event` goes under "<event name> packs" (events in the
 * collection `sort` order), every other pack under "Everyday packs". Pack order
 * inside a group is the catalogue's. Empty groups are dropped.
 */
export function packGroups(views: readonly PackView[] = packViews()): PackGroup[] {
  const events = CATALOGUE.collections.filter((c) => c.kind === "event").sort((a, b) => a.sort - b.sort);
  const groups: PackGroup[] = events.map((c) => ({
    id: c.id,
    title: `${c.name} packs`,
    packs: views.filter((v) => v.pack.collection === c.id),
  }));
  const eventIds = new Set(events.map((c) => c.id));
  groups.push({ id: "everyday", title: "Everyday packs", packs: views.filter((v) => !eventIds.has(v.pack.collection)) });
  return groups.filter((g) => g.packs.length > 0);
}

export interface Source {
  pack: Pack;
  how: "fixed" | "chance";
}

/**
 * Which packs can contain a card (current version), and whether it is a fixed
 * slot or a chance. Commemorative cards are only ever fixed. A card that no
 * current pack can give returns an empty list (it may have been granted in the past).
 */
export function cardSources(card: Collectible): Source[] {
  const out: Source[] = [];
  for (const pack of CATALOGUE.packs.filter((p) => !p.closed)) {
    const slots = currentVersion(pack).slots;
    if (slots.some((s) => s.kind === "fixed" && s.collectible === card.id)) {
      out.push({ pack, how: "fixed" });
      continue;
    }
    const byChance = slots.some(
      (s) => s.kind === "random" && (s.rarityWeights[card.rarity] ?? 0) > 0 && eligibleCards(CATALOGUE, s.pool).some((c) => c.id === card.id),
    );
    if (byChance) out.push({ pack, how: "chance" });
  }
  return out;
}

/** The URL a card is shared at. Never identifies the player. */
export const cardPath = (id: string) => `/collectibles/${id}`;
