/**
 * HallPass — the achievements barrel: the live store bound to the shared Neon
 * client, plus the fail-soft reads that public pages use.
 *
 * Mirrors `reviews/index.ts` and `social/index.ts`. The factory in `store.ts`
 * stays free of `server-only` so it can be unit-tested with a fake tagged
 * template; THIS module reaches for the real connection, so it is the one that
 * must never reach a client bundle.
 *
 * WHY THE FAIL-SOFT WRAPPERS EXIST. Schema here is applied BY HAND (see
 * `scoreboard/migrations/`), so there is always a window where this code is live
 * against a database that has no `achievements` table yet. Reads therefore
 * degrade to empty exactly as `getGameMedia()` does — a missing table must turn
 * the trophy shelf off, not 500 the game page it sits on.
 *
 * The wrappers swallow the RESULT but not the SIGNAL: a missing table or an
 * unconfigured `DATABASE_URL` is expected during that window and stays quiet,
 * while anything else is logged before degrading. `db.ts` is explicit that
 * `isMissingColumnError` must never be used to swallow errors generally, and a
 * genuine Neon outage that vanished without a log line would be indistinguishable
 * from "no achievements provisioned" — which is the failure mode this whole
 * pattern exists to avoid elsewhere.
 *
 * The WRITE is deliberately NOT wrapped. `record()` already returns a reason
 * rather than throwing for every expected refusal, and a route needs to
 * distinguish "refused" from "the database is down" to pick a status code. The
 * one exception is folded in below: a missing table genuinely IS
 * `unknown-achievement` — nothing is provisioned if there is nowhere to
 * provision it.
 */

import "server-only";
import { isMissingColumnError, isUnconfiguredDbError, sql } from "@/app/lib/db";
import { createAchievementStore } from "./store";
import type {
  AchievementDef,
  EarnedAchievement,
  PlayerAchievement,
  UnlockResult,
} from "./store";
import type { UnlockReason } from "./config";

/** The live store. Use it directly where you want errors to surface. */
export const achievements = createAchievementStore(sql);

export type {
  AchievementDef,
  AchievementStore,
  EarnedAchievement,
  PlayerAchievement,
  UnlockResult,
} from "./store";

/**
 * True when `error` is the expected "this deployment is ahead of its schema"
 * shape, i.e. safe to degrade silently. Anything else is a real fault and gets a
 * log line on the way past.
 */
function isExpectedSchemaGap(error: unknown): boolean {
  return isMissingColumnError(error) || isUnconfiguredDbError(error);
}

function degrade<T>(where: string, error: unknown, fallback: T): T {
  if (!isExpectedSchemaGap(error)) {
    console.error(`achievements.${where} failed; degrading:`, error);
  }
  return fallback;
}

/** One game's provisioned achievements. Fail-soft to `[]`. */
export async function getAchievementCatalogue(
  slug: string,
): Promise<AchievementDef[]> {
  try {
    return await achievements.catalogue(slug);
  } catch (error) {
    return degrade("catalogue", error, []);
  }
}

/**
 * One game's achievements as seen by one player (or by nobody).
 *
 * Fail-soft to an empty shelf with zeroed points rather than to `null`: the
 * caller renders "no achievements yet" for a game that has none anyway, so a
 * degraded read and an unprovisioned game look the same on screen. Making
 * callers handle a third "unavailable" state would put a branch on every render
 * for a case that has nothing distinct to say.
 */
export async function getPlayerAchievements(
  slug: string,
  playerId: string | null,
): Promise<{
  achievements: PlayerAchievement[];
  earnedPoints: number;
  totalPoints: number;
}> {
  try {
    return await achievements.forPlayer(slug, playerId);
  } catch (error) {
    return degrade("forPlayer", error, {
      achievements: [],
      earnedPoints: 0,
      totalPoints: 0,
    });
  }
}

/** A player's earned achievements across all games. Fail-soft to `[]`. */
export async function getEarnedAchievements(
  playerId: string,
  limit?: number,
): Promise<EarnedAchievement[]> {
  try {
    return await achievements.earnedForPlayer(playerId, limit);
  } catch (error) {
    return degrade("earnedForPlayer", error, []);
  }
}

/**
 * A player's total achievement points. Fail-soft to `0`.
 *
 * `0` is the honest degraded value here: `badges.ts` treats this as one input
 * among many, and a zero simply means the points-derived badge is not awarded
 * this render — no badge is ever wrongly GRANTED by a failed read.
 */
export async function getAchievementPoints(playerId: string): Promise<number> {
  try {
    return await achievements.pointsForPlayer(playerId);
  } catch (error) {
    return degrade("pointsForPlayer", error, 0);
  }
}

/** `key -> percentage earned` for one game. Fail-soft to `{}`. */
export async function getAchievementRarity(
  slug: string,
): Promise<Record<string, number>> {
  try {
    return await achievements.rarity(slug);
  } catch (error) {
    return degrade("rarity", error, {});
  }
}

/**
 * Record a batch, translating a missing table into `unknown-achievement`.
 *
 * Every OTHER failure is rethrown so the route can answer 503 rather than
 * telling a game its keys are wrong when the truth is that Neon is unreachable —
 * an SDK that logs "unknown achievement" during an outage sends its author
 * hunting for a provisioning bug that does not exist.
 */
export async function recordAchievements(input: {
  slug: string;
  playerId: string | null;
  entries: { key: string; progress?: number | null }[];
}): Promise<{ ok: boolean; reason?: UnlockReason; results: UnlockResult[] }> {
  try {
    return await achievements.record(input);
  } catch (error) {
    if (isMissingColumnError(error)) {
      return { ok: true, reason: "unknown-achievement", results: [] };
    }
    throw error;
  }
}
