/**
 * HallPass — actually sending a Web Push.
 *
 * The only module here that touches the network or `web-push`. Kept apart from
 * `store.ts` and `payload.ts` so both of those stay unit-testable with no
 * transport in the way.
 *
 * ── EVERY FAILURE IS SWALLOWED, ON PURPOSE ─────────────────────────────────
 * The caller is always a path that has ALREADY COMMITTED the thing being
 * announced — a challenge written, a friend request accepted, a game marked new.
 * A push that does not go out is a notification somebody misses; a throw here
 * would turn a successful action into an apparent failure, and the player would
 * retry something that already happened. The second is far worse, so nothing in
 * this file may reject.
 *
 * ── HYGIENE HAPPENS HERE BECAUSE THERE IS NO CRON ──────────────────────────
 * A push service answers `404`/`410 Gone` for an endpoint that no longer exists
 * — an uninstalled PWA, a cleared browser profile, a revoked permission. That
 * response is the ONLY moment the repo can learn a subscription is dead, so the
 * row is deleted right then. `007_social_graph.sql` states there is no cron to
 * sweep with, and this is the design that needs none.
 *
 * ── WHY IT IS FIRE-AND-FORGET AT THE CALL SITE ─────────────────────────────
 * `sendPushToPlayers` is awaited, but it resolves once every device has been
 * ATTEMPTED, not once anybody has read anything. Push services are third parties
 * with their own latency, and a slow one must not hold a player's request open —
 * so each send carries its own timeout and the whole batch runs concurrently.
 */

import "server-only";
import webpush from "web-push";
import { isPushConfigured, vapidConfig } from "./config";
import type { NotificationPush } from "./payload";
import { push } from "./index";
import type { PushDevice } from "./store";

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
 * Push one payload to every device belonging to each of `playerIds`.
 *
 * A no-op — silently, and without a database read — when VAPID keys are not
 * configured, so the whole feature ships dark and lights up when the env vars
 * land. That is the same graceful-when-unconfigured contract `db.ts` honours for
 * `DATABASE_URL`.
 *
 * ── IT TAKES A BUILT PAYLOAD, NOT THE FACTS TO BUILD ONE ───────────────────
 * This used to be `notifyChallenge`, which took a challenge and did its own
 * wording. It takes a finished {@link NotificationPush} now because the SAME
 * title and body have to reach two places — the stored bell row and the device —
 * and building them twice is how a notification comes to say one thing in the
 * inbox and another on a phone. `deliver.ts` builds it once and hands it here.
 *
 * ── THE DEVICE LOOKUP IS ONE QUERY PER PLAYER ──────────────────────────────
 * Fine for the personal kinds, which have one recipient, and for the admin ones,
 * which have a handful. The BROADCAST path does not come through here with every
 * player in the site — `deliver.ts` narrows to the opted-in few first, which is
 * the reason `broadcastPushPlayerIds` exists at all.
 */
export async function sendPushToPlayers(
  playerIds: string[],
  notification: NotificationPush,
): Promise<void> {
  try {
    if (!isPushConfigured()) return;
    if (playerIds.length === 0) return;

    const { publicKey, privateKey, subject } = vapidConfig();
    webpush.setVapidDetails(subject, publicKey, privateKey);

    // The payload carries BOTH the full and the discreet wording; the service
    // worker picks by a per-device flag mirrored into IndexedDB. See payload.ts
    // for why that beats redacting here.
    const payload = JSON.stringify(notification);

    const deviceLists = await Promise.all(
      playerIds.map((playerId) =>
        // One player's unreadable devices must not cost the others theirs.
        push.devicesFor(playerId).catch((error) => {
          console.error(`[push] devicesFor(${playerId}) failed:`, error);
          return [] as PushDevice[];
        }),
      ),
    );

    // Concurrent, and every one already resolves — so this cannot reject and
    // one dead device cannot stop another from being reached.
    await Promise.all(
      deviceLists.flat().map((device) => sendTo(device, payload)),
    );
  } catch (error) {
    // Includes the missing-table window before migration 023 is applied.
    console.error("[push] sendPushToPlayers failed:", error);
  }
}
