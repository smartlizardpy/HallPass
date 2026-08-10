/**
 * HallPass — actually sending a Web Push.
 *
 * The only module here that touches the network or `web-push`. Kept apart from
 * `store.ts` and `payload.ts` so both of those stay unit-testable with no
 * transport in the way.
 *
 * ── EVERY FAILURE IS SWALLOWED, ON PURPOSE ─────────────────────────────────
 * The caller is the challenge-create path, which has already written the row by
 * the time this runs. A push that does not go out is a notification somebody
 * misses; a throw here would be a challenge that appears to have failed and was
 * not sent at all. The second is far worse, so nothing in this file may reject.
 *
 * ── HYGIENE HAPPENS HERE BECAUSE THERE IS NO CRON ──────────────────────────
 * A push service answers `404`/`410 Gone` for an endpoint that no longer exists
 * — an uninstalled PWA, a cleared browser profile, a revoked permission. That
 * response is the ONLY moment the repo can learn a subscription is dead, so the
 * row is deleted right then. `007_social_graph.sql` states there is no cron to
 * sweep with, and this is the design that needs none.
 *
 * ── WHY IT IS FIRE-AND-FORGET AT THE CALL SITE ─────────────────────────────
 * `notifyChallenge` is awaited, but it resolves once every device has been
 * ATTEMPTED, not once anybody has read anything. Push services are third parties
 * with their own latency, and a slow one must not hold a player's request open —
 * so each send carries its own timeout and the whole batch runs concurrently.
 */

import "server-only";
import webpush from "web-push";
import { isPushConfigured, vapidConfig } from "./config";
import { challengeNotification } from "./payload";
import { createPushStore, type PushDevice } from "./store";
import { sql } from "@/app/lib/db";

const push = createPushStore(sql);

/** Give up on one push service rather than hold a request open for it. */
const SEND_TIMEOUT_MS = 5000;

/** Statuses that mean "this endpoint is gone" rather than "this attempt failed". */
const DEAD_STATUSES = new Set([404, 410]);

/**
 * Send one payload to one device, pruning the row if the endpoint is dead.
 *
 * Resolves either way. The distinction it DOES draw is the one that matters:
 * a dead endpoint is deleted, while a transient failure (a 500 from the push
 * service, a timeout) leaves the row alone so the next challenge can try again.
 * Deleting on any error would quietly unsubscribe people during an outage.
 */
async function sendTo(device: PushDevice, payload: string): Promise<void> {
  try {
    await webpush.sendNotification(
      {
        endpoint: device.endpoint,
        keys: { p256dh: device.p256dh, auth: device.auth },
      },
      payload,
      { TTL: 60 * 60 * 24, timeout: SEND_TIMEOUT_MS },
    );
  } catch (error) {
    const status = (error as { statusCode?: unknown })?.statusCode;
    if (typeof status === "number" && DEAD_STATUSES.has(status)) {
      try {
        await push.removeDead(device.endpoint);
      } catch (removeError) {
        console.error("[push] pruning a dead endpoint failed:", removeError);
      }
      return;
    }
    // Transient: log once and leave the subscription in place.
    console.error(`[push] send failed (${String(status ?? "no status")}):`, error);
  }
}

/**
 * Tell a player, on every device they have subscribed, that they were
 * challenged.
 *
 * A no-op — silently, and without a database read — when VAPID keys are not
 * configured, so the whole feature ships dark and lights up when the env vars
 * land. That is the same graceful-when-unconfigured contract `db.ts` honours for
 * `DATABASE_URL`.
 */
export async function notifyChallenge(input: {
  targetPlayerId: string;
  from: string;
  game: string | null;
  boardTitle: string;
}): Promise<void> {
  try {
    if (!isPushConfigured()) return;

    const { publicKey, privateKey, subject } = vapidConfig();
    webpush.setVapidDetails(subject, publicKey, privateKey);

    const devices = await push.devicesFor(input.targetPlayerId);
    if (devices.length === 0) return;

    // The payload carries BOTH the full and the discreet wording; the service
    // worker picks by a per-device flag mirrored into IndexedDB. See payload.ts
    // for why that beats redacting here.
    const payload = JSON.stringify(
      challengeNotification({
        from: input.from,
        game: input.game,
        boardTitle: input.boardTitle,
      }),
    );

    // Concurrent, and every one already resolves — so this cannot reject and
    // one dead device cannot stop another from being reached.
    await Promise.all(devices.map((device) => sendTo(device, payload)));
  } catch (error) {
    // Includes the missing-table window before migration 023 is applied.
    console.error("[push] notifyChallenge failed:", error);
  }
}
