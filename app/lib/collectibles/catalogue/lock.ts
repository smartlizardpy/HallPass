/**
 * The catalogue lock: a sha256 of every published pack version and the list of
 * published collectible ids. Server/test-side only (node:crypto).
 *
 * Immutable on purpose (docs/collectibles-design.md §1.3): a grant pins a pack
 * version, so editing a published version would silently change what already
 * granted, still-sealed packs contain. The test in `catalogue.test.ts` compares
 * the live catalogue to `catalogue.lock.json`.
 */

import { createHash } from "node:crypto";
import type { Catalogue, Pack, PackVersion } from "./types";

export interface CatalogueLock {
  /** `<packId>@<v>` → sha256 of the canonical version JSON. */
  packs: Record<string, string>;
  /** Every collectible id ever published. Cards are retired, never deleted. */
  collectibles: string[];
}

/** Canonical form: keys in a fixed order, so a reformat never changes a hash. */
export function canonicalVersion(pack: Pack, version: PackVersion): string {
  return JSON.stringify({
    pack: pack.id,
    collection: pack.collection,
    v: version.v,
    size: version.size,
    slots: version.slots.map((s) =>
      s.kind === "fixed"
        ? { kind: "fixed", collectible: s.collectible }
        : {
            kind: "random",
            pool: s.pool,
            weights: (["common", "uncommon", "rare", "epic", "legendary"] as const).map((r) => [r, s.rarityWeights[r] ?? 0]),
          },
    ),
  });
}

export function computeLock(cat: Catalogue): CatalogueLock {
  const packs: Record<string, string> = {};
  for (const p of cat.packs) {
    for (const v of p.versions) packs[`${p.id}@${v.v}`] = createHash("sha256").update(canonicalVersion(p, v)).digest("hex");
  }
  return { packs, collectibles: cat.collectibles.map((c) => c.id).sort() };
}
