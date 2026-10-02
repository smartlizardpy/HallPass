import "server-only";

/**
 * HallPass — telling a player about their streak.
 *
 * Two producers, both thin wrappers over `notifyPlayer` so the delivery rules
 * (preferences, dedupe, push-only-if-written, never throwing) are the ones every
 * other kind already follows. Awaited rather than floated, matching
 * `challenges/notify.ts`: on serverless the response ending can end the
 * invocation, and a floating promise gets cancelled often enough to look flaky.
 *
 * Both swallow their own failures. The milestone runs behind a beacon that has
 * already recorded the day, and the reminder runs in a batch where one bad row
 * must not stop the rest.
 */

import {
  streakAtRiskCopy,
  streakMilestoneCopy,
} from "@/app/lib/notifications/copy";
import { notifyPlayer } from "@/app/lib/notifications/deliver";
import { runStartDay } from "./server-core";

/**
 * A streak reached a milestone length on `day`.
 *
 * KEYED ON THE RUN, not on the length: "the 7-day run that began on the 1st" is
 * one event, so a retried beacon cannot tell somebody twice, while a later,
 * separate seven-day run is a new event and is told.
 */
export async function notifyStreakMilestone(
  playerId: string,
  current: number,
  day: string,
): Promise<void> {
  try {
    await notifyPlayer(playerId, {
      kind: "streak_milestone",
      copy: streakMilestoneCopy({ current }),
      dedupeKey: `streak_milestone:${current}:${runStartDay(day, current)}`,
    });
  } catch (error) {
    console.error(`[streak] milestone for ${playerId} failed:`, error);
  }
}

/**
 * Remind a player their streak ends tonight.
 *
 * Keyed on the player's own local day. The store's `claimNudge` is what actually
 * stops a repeat; this key is the second lock, so even a claim that somehow
 * succeeded twice files one row and therefore buzzes once.
 */
export async function notifyStreakAtRisk(
  playerId: string,
  current: number,
  localDay: string,
): Promise<void> {
  try {
    await notifyPlayer(playerId, {
      kind: "streak_at_risk",
      copy: streakAtRiskCopy({ current }),
      dedupeKey: `streak_at_risk:${localDay}`,
    });
  } catch (error) {
    console.error(`[streak] reminder for ${playerId} failed:`, error);
  }
}
