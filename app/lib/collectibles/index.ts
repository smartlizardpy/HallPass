/**
 * HallPass — the collectibles barrel: the live store bound to the shared Neon
 * client, and the reads every surface uses.
 *
 * Mirrors `championship/index.ts`: the factory stays testable with a fake `sql`;
 * this module holds the real connection, so it is `server-only`.
 *
 * FAIL-SOFT READS. Migration 049 is applied by hand, so this code can be live
 * against a database without the collectibles tables. Reads then say
 * `available: false` (the UI shows "unavailable") instead of 500ing the page they
 * sit on. Unexpected errors are logged on the way past; a missing table or an
 * unconfigured database is expected and stays quiet. WRITES are not softened: an
 * open that fails must say so.
 */

import "server-only";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import { getCollectible } from "./catalogue";
import { collectionProgress, type CollectionProgress } from "./progress";
import { createCollectiblesStore, type BinderEntry, type OpenedPack, type PlayerPack } from "./store";

export const collectiblesStore = createCollectiblesStore(sql);

function expected(error: unknown): boolean {
  return isMissingColumnError(error) || isUnconfiguredDbError(error);
}

function degrade<T>(where: string, error: unknown, fallback: T): T {
  if (!expected(error)) console.error(`collectibles.${where} failed; degrading:`, error);
  return fallback;
}

export interface MyCollection {
  available: boolean;
  sealed: PlayerPack[];
  recent: OpenedPack[];
  binder: BinderEntry[];
  progress: CollectionProgress[];
}

/** A player's sealed packs, recent openings and binder. Never throws. */
export async function getMyCollection(playerId: string): Promise<MyCollection> {
  try {
    const [sealed, recent, binder] = await Promise.all([
      collectiblesStore.listSealed(playerId),
      collectiblesStore.listOpened(playerId, 10),
      collectiblesStore.binder(playerId),
    ]);
    return { available: true, sealed, recent, binder, progress: collectionProgress(binder) };
  } catch (error) {
    return degrade("getMyCollection", error, { available: false, sealed: [], recent: [], binder: [], progress: collectionProgress([]) });
  }
}

export interface Showcase {
  available: boolean;
  /** `null` when there is no such player, or their profile is not public. */
  player: { publicId: string; name: string; avatar: string } | null;
  featured: { position: number; collectibleId: string; name: string; rarity: string; art: string }[];
}

/** The featured cards of a PUBLIC profile, by username. Public name and avatar only. Never throws. */
export async function getShowcase(username: string): Promise<Showcase> {
  try {
    const who = await collectiblesStore.findPublicPlayer(username);
    if (!who) return { available: true, player: null, featured: [] };
    const rows = await collectiblesStore.featured(who.playerId);
    const featured = rows.flatMap((r) => {
      const card = getCollectible(r.collectibleId);
      return card ? [{ position: r.position, collectibleId: card.id, name: card.name, rarity: card.rarity, art: card.art.src }] : [];
    });
    return { available: true, player: { publicId: who.publicId, name: who.name, avatar: who.avatar }, featured };
  } catch (error) {
    return degrade("getShowcase", error, { available: false, player: null, featured: [] });
  }
}
