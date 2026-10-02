/**
 * Streak reminders — `POST /api/v1/admin/streaks/remind`.
 *
 * Sends the "your streak ends tonight" push to every player who is due one right
 * now. Driven hourly by `.github/workflows/streak-reminders.yml` through
 * `scripts/send-streak-reminders.mjs`; like the site alerts, nothing on a
 * serverless deployment wakes up to do this by itself.
 *
 * ── THE RUNNER DECIDES NOTHING ─────────────────────────────────────────────
 * The body carries no player ids and no text. Who is due is a database question
 * answered here (`dueForReminder`), and the wording is built by
 * `streakAtRiskCopy`. The credential lives in a GitHub repository's settings, so
 * the worst a holder can do is trigger the reminder early or repeatedly — and
 * `claimNudge` makes "repeatedly" mean once.
 *
 * ── AT MOST ONCE PER PLAYER PER LOCAL DAY ──────────────────────────────────
 * The nudge is CLAIMED before it is sent. A failure after the claim costs one
 * missed reminder; a claim after the send would let an overlapping run repeat it,
 * and a reminder twice is worse than none.
 *
 * ── A BROKEN SCHEMA IS LOUD HERE ───────────────────────────────────────────
 * Unlike the beacon, this answers 503 when a table it reads is missing
 * (`player_streaks` or `push_subscriptions`, and the message says which): the
 * caller is a CI job whose whole purpose is to be seen failing, and "nothing to
 * send" every hour for ever is the failure `check-alerts.mjs` was written to
 * avoid.
 *
 * `due` is the number processed this run, at most `cap`; `capped: true` means
 * MORE were due than the cap allowed (see the comment at the cap below).
 *
 * `claimed` is how many players this run reserved a reminder for; `filed` is how
 * many of those actually had a notification written (and, if they are on push, a
 * push attempted). They differ when a player has switched the kind off, or the
 * insert failed after the claim. Neither claims a device RECEIVED anything — the
 * push transport swallows per-device failures by design, so that is not knowable
 * here, and the field is named for what is.
 *
 * `{ "dryRun": true }` reports who is due and claims and sends nothing.
 */

import { alertsAuthGate, alertsError } from "@/app/lib/alerts/http";
import { isMissingStreakSchema, streaks } from "@/app/lib/streak";
import { missingSchemaMessage } from "@/app/lib/streak/missing-schema";
import { notifyStreakAtRisk } from "@/app/lib/streak/notify";
import { REMINDER_RUN_CAP } from "@/app/lib/streak/server-core";

/**
 * The longest this route may run, in seconds (Route Segment Config —
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`;
 * the platform applies it from the build output).
 *
 * A full run is `REMINDER_RUN_CAP` players in batches of {@link BATCH}: each a
 * claim, a preferences read, a bell insert and a push lookup, so on the order of
 * a few hundred milliseconds a batch. 60s covers a capped run with room to spare
 * and matches the runner's own 60s request timeout in
 * `scripts/send-streak-reminders.mjs`, so the two give up together instead of the
 * runner abandoning a function that is still working.
 */
export const maxDuration = 60;

/** Players notified at once. Small: each is a few queries and a push. */
const BATCH = 10;

export async function POST(req: Request): Promise<Response> {
  const denied = alertsAuthGate(req.headers);
  if (denied) return denied;

  let dryRun = false;
  try {
    dryRun = ((await req.json()) as { dryRun?: unknown } | null)?.dryRun === true;
  } catch {
    dryRun = false;
  }

  let due;
  try {
    // ONE MORE than the cap, so "there were more than the cap" is knowable
    // without a second COUNT query. Only the first `cap` are processed.
    due = await streaks.dueForReminder(new Date(), REMINDER_RUN_CAP + 1);
  } catch (error) {
    if (isMissingStreakSchema(error)) {
      // The query reads player_streaks (036) AND push_subscriptions (023), so say
      // which one Postgres actually complained about.
      return alertsError(missingSchemaMessage(error), 503);
    }
    console.error("streaks/remind dueForReminder failed:", error);
    return alertsError("Could not read who is due a reminder", 500);
  }

  // THE PER-RUN CAP, AND WHAT IT COSTS. A player's reminder hour is 17:00 local,
  // so one run reaches only the slice of players whose offset puts them in that
  // hour, and the runner knocks once an hour. Players past the cap are NOT picked
  // up later: next hour a different slice is in its 17:00, and theirs has passed,
  // so they miss that day's reminder. `ORDER BY player_id` also means the same
  // players are always first in line. That is the right trade at this scale — a
  // runaway query or a leaked secret cannot fan out unbounded pushes — but it is a
  // real ceiling, which is why `capped` is reported and the runner warns. If one
  // offset's slice ever approaches the cap, raise it (and `maxDuration`) or fan
  // out across several runs rather than ignoring the warning.
  const capped = due.length > REMINDER_RUN_CAP;
  due = due.slice(0, REMINDER_RUN_CAP);

  if (dryRun) {
    return Response.json({
      ok: true,
      dryRun: true,
      due: due.length,
      cap: REMINDER_RUN_CAP,
      capped,
      claimed: 0,
      filed: 0,
    });
  }

  let claimed = 0;
  let filed = 0;
  for (let i = 0; i < due.length; i += BATCH) {
    await Promise.all(
      due.slice(i, i + BATCH).map(async (player) => {
        try {
          if (!(await streaks.claimNudge(player.playerId, player.localDay))) return;
          claimed += 1;
          if (await notifyStreakAtRisk(player.playerId, player.current, player.localDay)) {
            filed += 1;
          }
        } catch (error) {
          console.error(`streaks/remind ${player.playerId} failed:`, error);
        }
      }),
    );
  }

  return Response.json({
    ok: true,
    dryRun: false,
    due: due.length,
    cap: REMINDER_RUN_CAP,
    capped,
    claimed,
    filed,
  });
}
