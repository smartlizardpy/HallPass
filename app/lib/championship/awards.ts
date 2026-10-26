/**
 * HallPass — who a championship's rewards go to. Pure.
 *
 * Derived from the standings at finalisation and frozen into the snapshot, so a
 * later account deletion or a re-run of "grant rewards" pays exactly the
 * players who were decided, once. Each award carries its grant key: the
 * collectibles grant service refuses a second grant with the same key, which is
 * what makes "grant rewards" safe to press again after a failure.
 *
 * WHAT EARNS WHAT (published on /fright-fest):
 *   - Participation Pack: an accepted result on every board that counted.
 *   - Game Champion Pack: first place on a board that counted.
 *   - Overall Champion Pack: the top ELIGIBLE player of the overall table (a
 *     result on every counting board), not merely the most points.
 * One player can earn several.
 */

import type { Standings } from "./standings";
import type { ChampionshipConfig } from "./types";

export type AwardKind = "participation" | "game-champion" | "overall-champion";

export interface Award {
  kind: AwardKind;
  /** The collectibles pack id this award pays. */
  packId: string;
  /** Idempotency key for the grant: never changes for the same award. */
  grantKey: string;
  /** Internal `players.id`. Server-side only; the snapshot keeps `publicId`. */
  playerId: string;
  publicId: string;
  /** The board, for a game-champion award. */
  gameSlug?: string;
}

export function grantKey(c: ChampionshipConfig, kind: AwardKind, playerId: string, gameSlug?: string): string {
  if (kind === "participation") return `${c.id}:participation:${playerId}`;
  if (kind === "overall-champion") return `${c.id}:overall:${playerId}`;
  return `${c.id}:champion:${gameSlug}:${playerId}`;
}

/** Every award the standings decide. Order: overall, game champions (config order), participation. */
export function awardsFrom(c: ChampionshipConfig, s: Standings): Award[] {
  const out: Award[] = [];
  const champ = s.overall.find((o) => o.eligible);
  if (champ) {
    out.push({
      kind: "overall-champion",
      packId: c.rewards.overallChampion,
      grantKey: grantKey(c, "overall-champion", champ.playerId),
      playerId: champ.playerId,
      publicId: champ.publicId,
    });
  }
  for (const b of s.boards) {
    const first = b.counting ? b.entries[0] : undefined;
    const pack = c.rewards.gameChampion[b.slug];
    if (!first || !pack) continue;
    out.push({
      kind: "game-champion",
      packId: pack,
      grantKey: grantKey(c, "game-champion", first.playerId, b.slug),
      playerId: first.playerId,
      publicId: first.publicId,
      gameSlug: b.slug,
    });
  }
  for (const o of s.overall) {
    if (!o.eligible) continue;
    out.push({
      kind: "participation",
      packId: c.rewards.participation,
      grantKey: grantKey(c, "participation", o.playerId),
      playerId: o.playerId,
      publicId: o.publicId,
    });
  }
  return out;
}

/** The public form of the awards, for the frozen snapshot: no internal ids, no grant keys. */
export interface PublicAwards {
  overallChampion: string | null;
  gameChampions: Record<string, string>;
  participants: string[];
}

export function publicAwards(awards: readonly Award[]): PublicAwards {
  const out: PublicAwards = { overallChampion: null, gameChampions: {}, participants: [] };
  for (const a of awards) {
    if (a.kind === "overall-champion") out.overallChampion = a.publicId;
    else if (a.kind === "game-champion" && a.gameSlug) out.gameChampions[a.gameSlug] = a.publicId;
    else if (a.kind === "participation") out.participants.push(a.publicId);
  }
  return out;
}
