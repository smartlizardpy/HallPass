/**
 * The catalogue: static, typed data plus lookups. Import from here.
 * Pure (no IO), so pages and server code may both use it.
 */

import { COLLECTIBLES } from "./collectibles";
import { COLLECTIONS } from "./collections";
import { PACKS } from "./packs";
import type { Catalogue, Collectible, Collection, Pack, PackVersion } from "./types";

export * from "./types";
export { ODDS } from "./odds";
export { eligibleCards, validateCatalogue } from "./validate";

export const CATALOGUE: Catalogue = { collections: COLLECTIONS, collectibles: COLLECTIBLES, packs: PACKS };

const collectibleById = new Map(COLLECTIBLES.map((c) => [c.id, c]));
const collectionById = new Map(COLLECTIONS.map((c) => [c.id, c]));
const packById = new Map(PACKS.map((p) => [p.id, p]));

export const getCollectible = (id: string): Collectible | undefined => collectibleById.get(id);
export const getCollection = (id: string): Collection | undefined => collectionById.get(id);
export const getPack = (id: string): Pack | undefined => packById.get(id);
export const cardsIn = (collection: string): Collectible[] => COLLECTIBLES.filter((c) => c.collection === collection);

/** The version a NEW grant pins: the highest published. */
export function currentVersion(pack: Pack): PackVersion {
  return pack.versions[pack.versions.length - 1];
}

export function packVersion(packId: string, v: number): { pack: Pack; version: PackVersion } | undefined {
  const pack = packById.get(packId);
  const version = pack?.versions.find((x) => x.v === v);
  return pack && version ? { pack, version } : undefined;
}

export const packEmblemSrc = (collection: string) => `/collectibles/packs/${collection}.png`;
export const collectionSymbolSrc = (collection: string) => `/collectibles/symbols/${collection}.png`;

/** Every pack's print is pixel art at this size; the site draws it at whole-number scales. */
export const PACK_PRINT_PX = { w: 96, h: 140 } as const;
/** The front of a pack, with its silhouette in alpha (public/collectibles/ART.md). */
export const packPrintSrc = (packId: string) => `/collectibles/packs/print/${packId}.png`;
/** White where the print is foil: the opening turns it into the wrapper's metal and gloss. */
export const packFoilSrc = (packId: string) => `/collectibles/packs/print/${packId}-foil.png`;
