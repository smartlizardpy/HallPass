/**
 * HallPass — paying a finalised championship's rewards as collectible packs.
 *
 * The championship decides WHO earns WHAT when it is finalised, and freezes that
 * decision (public ids only) into its snapshot (`awards.ts`). This module turns
 * that frozen decision into pack grants. It reads only the snapshot, never live
 * standings, so a re-run after finalisation pays exactly the players who were
 * decided, however the live table moves afterwards.
 *
 * SAFE TO RUN AGAIN. Every grant carries the championship's grant key
 * (`fright-fest-2026:overall:<player>` and so on), and the collectibles store
 * refuses a second pack with the same key. A run that half-failed (the
 * collectibles tables missing, a timeout) is finished by running it again: what
 * was granted reports as "already", the rest is granted now.
 *
 * A player who deleted their account between finalisation and the grant has no
 * internal id any more; their award is counted as `missingPlayer`, not retried.
 *
 * Dependencies are injected (the dashboard passes the real stores), so this is
 * testable without a database.
 */

import { grantKey, type AwardKind, type PublicAwards } from "../championship/awards";
import type { ChampionshipConfig } from "../championship/types";
import { getPack } from "./catalogue";
import type { GrantInput, PlayerPack } from "./store";

export interface RewardGrant {
  kind: AwardKind;
  publicId: string;
  packId: string;
  gameSlug?: string;
}

function isPublicAwards(v: unknown): v is PublicAwards {
  if (!v || typeof v !== "object") return false;
  const a = v as PublicAwards;
  return (
    (a.overallChampion === null || typeof a.overallChampion === "string") &&
    !!a.gameChampions &&
    typeof a.gameChampions === "object" &&
    Array.isArray(a.participants)
  );
}

/** The grants a frozen snapshot decides. `null` when the snapshot holds no awards (not finalised). Pure. */
export function grantsFromSnapshot(c: ChampionshipConfig, snapshot: unknown): RewardGrant[] | null {
  const awards = snapshot && typeof snapshot === "object" ? (snapshot as { awards?: unknown }).awards : undefined;
  if (!isPublicAwards(awards)) return null;
  const out: RewardGrant[] = [];
  if (awards.overallChampion) out.push({ kind: "overall-champion", publicId: awards.overallChampion, packId: c.rewards.overallChampion });
  for (const g of c.games) {
    const winner = awards.gameChampions[g.slug];
    const packId = c.rewards.gameChampion[g.slug];
    if (typeof winner === "string" && packId) out.push({ kind: "game-champion", publicId: winner, packId, gameSlug: g.slug });
  }
  for (const p of awards.participants) {
    if (typeof p === "string") out.push({ kind: "participation", publicId: p, packId: c.rewards.participation });
  }
  return out;
}

export interface RewardsReport {
  decided: number;
  /** Granted by this run. */
  created: number;
  /** Granted by an earlier run (same grant key). */
  already: number;
  /** The player no longer exists. */
  missingPlayer: number;
  /** The pack id is not in the catalogue: a configuration error, reported, never guessed. */
  unknownPack: number;
  /** Errors; run again to finish. */
  failed: number;
}

export interface RewardsDeps {
  finalStandings(eventId: string): Promise<unknown | null>;
  internalIds(publicIds: string[]): Promise<Map<string, string>>;
  grantPack(input: GrantInput): Promise<{ created: boolean; pack: PlayerPack }>;
}

export async function payChampionshipRewards(c: ChampionshipConfig, deps: RewardsDeps): Promise<RewardsReport | { error: "not-final" }> {
  const grants = grantsFromSnapshot(c, await deps.finalStandings(c.id));
  if (!grants) return { error: "not-final" };
  const report: RewardsReport = { decided: grants.length, created: 0, already: 0, missingPlayer: 0, unknownPack: 0, failed: 0 };
  const ids = await deps.internalIds([...new Set(grants.map((g) => g.publicId))]);
  for (const g of grants) {
    if (!getPack(g.packId)) {
      report.unknownPack++;
      continue;
    }
    const playerId = ids.get(g.publicId);
    if (!playerId) {
      report.missingPlayer++;
      continue;
    }
    try {
      const { created } = await deps.grantPack({
        playerId,
        packId: g.packId,
        grantKey: grantKey(c, g.kind, playerId, g.gameSlug),
        source: "championship",
        sourceRef: c.id,
      });
      if (created) report.created++;
      else report.already++;
    } catch (error) {
      console.error(`[rewards] ${c.id} ${g.kind} grant failed`, error);
      report.failed++;
    }
  }
  return report;
}

/** One line for a banner or the audit log. */
export function describeRewards(r: RewardsReport): string {
  const parts = [`${r.created} granted now`, `${r.already} already granted`];
  if (r.missingPlayer) parts.push(`${r.missingPlayer} for deleted accounts (skipped)`);
  if (r.unknownPack) parts.push(`${r.unknownPack} with an unknown pack id (fix the config)`);
  if (r.failed) parts.push(`${r.failed} failed (press again to finish)`);
  return `${r.decided} reward${r.decided === 1 ? "" : "s"}: ${parts.join(", ")}.`;
}
