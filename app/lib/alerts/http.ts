/**
 * HallPass — what the two alert endpoints put on the wire, and who gets past
 * the door.
 *
 * Shared by `GET /api/v1/admin/alerts` and `POST /api/v1/admin/alerts/notify`
 * so the gate cannot drift between the half that measures and the half that
 * speaks — a probe that 401s while notify accepts (or the reverse) is a
 * confusing afternoon for whoever is holding the key.
 *
 * PURE of the database and of `server-only`: it reads headers and builds
 * responses. `scripts/check-alerts.mjs` is written against exactly these shapes.
 */

import type { ApiError } from "@/sdk/src/contract";
import type { AlertId } from "./config";
import { verifyAlertsSecret } from "./guard";
import type { AlertSnapshot, FiredAlert } from "./rules";

/** `GET /api/v1/admin/alerts` — what was measured, and what fired. */
export type AlertProbeResponse = {
  ok: true;
  snapshot: AlertSnapshot;
  alerts: FiredAlert[];
};

/** `POST /api/v1/admin/alerts/notify` — what was accepted for delivery. */
export type AlertNotifyResponse = {
  ok: true;
  /** Alerts handed to the notification path, in catalogue order. */
  notified: AlertId[];
  /**
   * Entries the body carried that were dropped: unknown ids, malformed numbers,
   * or a repeat of an id already in the same request.
   *
   * Reported rather than silently ignored, so a runner that has drifted from the
   * server's idea of an alert shows up as a number in the log instead of as
   * notifications that never arrive.
   */
  rejected: number;
};

/**
 * Gate an alerts endpoint, mapping the three auth outcomes to an early
 * `Response` — or `null` to continue.
 *
 * `unconfigured` is a 503 and not a 401 on purpose: "this deploy has no secret
 * set" is a server condition, and an operator reading a red CI log needs to tell
 * it apart from "my key is wrong". The message names the variable to set,
 * because the alternative is reading the source to find out.
 */
export function alertsAuthGate(headers: Headers): Response | null {
  const result = verifyAlertsSecret(headers);
  if (result === "unconfigured") {
    return Response.json(
      {
        error:
          "Site alerts are not configured. Set ALERTS_SECRET (or SCOREBOARD_ADMIN_SECRET) on the deployment.",
      } satisfies ApiError,
      { status: 503 },
    );
  }
  if (result === "unauthorized") {
    return Response.json({ error: "Unauthorized" } satisfies ApiError, { status: 401 });
  }
  return null;
}

/** One error body, shaped like every other error this API answers. */
export function alertsError(message: string, status: number): Response {
  return Response.json({ error: message } satisfies ApiError, { status });
}
