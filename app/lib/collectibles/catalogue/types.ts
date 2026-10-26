/**
 * HallPass Collectibles — catalogue types.
 *
 * The catalogue is code (docs/collectibles-design.md §1.2): reviewed,
 * typed data that players' rows reference by stable id and never copy. Pure:
 * no IO, nothing server-only, so pages may import it.
 */

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

/** Integer percentages by rarity. A random slot's weights must sum to 100. */
export type RarityWeights = Partial<Record<Rarity, number>>;

export type CollectionKind = "event" | "permanent";
export type CollectibleKind = "sticker" | "card";
export type Finish = "standard" | "foil" | "holo" | "animated";
export type Frame = "standard" | "event" | "champion";
/** `commemorative` cards come only from fixed slots, never from chance. */
export type CollectiblePool = "standard" | "commemorative";
export type ArtStatus = "demo" | "final";

export interface Collection {
  /** Short stable id; every collectible id in it is prefixed `<id>-`. */
  id: string;
  name: string;
  description: string;
  kind: CollectionKind;
  theme: { colours: string[]; wrapper: string };
  /** ISO dates; informational (the shelf, not the rules). Ownership never expires. */
  availableFrom?: string;
  availableUntil?: string;
  sort: number;
}

export interface Collectible {
  id: string;
  collection: string;
  /** 1-based position within the collection, contiguous. */
  number: number;
  name: string;
  caption: string;
  rarity: Rarity;
  kind: CollectibleKind;
  finish: Finish;
  frame: Frame;
  pool: CollectiblePool;
  art: { src: string; status: ArtStatus; alt: string };
  /** Retired cards stay in the catalogue (people own them) but leave random pools. */
  retired?: true;
}

export type Slot =
  | { kind: "fixed"; collectible: string }
  /** `pool` is a collection id: the eligible cards are its standard, unretired ones. */
  | { kind: "random"; pool: string; rarityWeights: RarityWeights };

export interface PackVersion {
  /** 1, 2, 3, ... Published versions are immutable (see catalogue.lock.json). */
  v: number;
  size: number;
  slots: Slot[];
}

export interface Pack {
  id: string;
  collection: string;
  name: string;
  description: string;
  wrapper: string;
  versions: PackVersion[];
}

export interface Catalogue {
  collections: Collection[];
  collectibles: Collectible[];
  packs: Pack[];
}
