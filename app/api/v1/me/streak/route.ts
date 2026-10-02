/**
 * Streak beacon — `POST /api/v1/me/streak`.
 *
 * Tells the server the signed-in player played on a new local day, so the
 * server can know their streak and later remind them about it. The browser fires
 * it from the device-local streak event (`hp:streak`), which itself fires only
 * on the first play of a local day, so this is at most one write per device per
 * day.
 *
 * Body: `{ day: "YYYY-MM-DD", tzOffsetMin: number }` — the device's own calendar
 * day and its UTC offset in minutes EAST of UTC (the negation of
 * `Date#getTimezoneOffset`). The day is clamped to within one day of the
 * server's UTC date; see `server-core.ts` for why a claim that cannot move
 * anything but the claimant's own flame is acceptable.
 *
 * A GUEST GETS `200 { recorded: false }`, NOT A 401 — the same rule as
 * `/api/v1/me/plays`: this is a fire-and-forget beacon and a 401 would put a red
 * error in every signed-out visitor's console. A missing table (migration 036 not
 * applied yet) answers the same way, quietly.
 */

import { isMissingStreakSchema, streaks } from "@/app/lib/streak";
import { isMilestone as isMilestoneLength } from "@/app/lib/streak/core";
import { notifyStreakMilestone } from "@/app/lib/streak/notify";
import { clampDay, parseTzOffset } from "@/app/lib/streak/server-core";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
} from "@/app/lib/social/request-guard";

export async function POST(req: Request): Promise<Response> {
  const playerId = await currentPlayerId();
  if (!playerId) {
    return Response.json({ ok: true, recorded: false }, { headers: NO_STORE });
  }

  let body: { day?: unknown; tzOffsetMin?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const day = clampDay(body?.day, Date.now());
  const tzOffsetMin = parseTzOffset(body?.tzOffsetMin);
  if (day === null || tzOffsetMin === null) {
    return Response.json(
      { ok: false, recorded: false },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const result = await streaks.recordDay(playerId, day, tzOffsetMin);
    if (result.advanced && isMilestoneLength(result.current)) {
      await notifyStreakMilestone(playerId, result.current, day);
    }
    return Response.json(
      { ok: true, recorded: result.advanced },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (!isMissingStreakSchema(error)) {
      console.error("me/streak failed:", error);
    }
    // Still 200: a beacon must never make noise in the player's console.
    return Response.json({ ok: true, recorded: false }, { headers: NO_STORE });
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("POST, OPTIONS");
}
