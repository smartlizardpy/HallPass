/**
 * HallPass site alerts, half one — `GET /api/v1/admin/alerts`.
 *
 * ASKS THE SITE HOW IT IS DOING AND SAYS SO. Measures the last hour against the
 * same hour on previous days, runs the rules, and answers both the raw snapshot
 * and whatever fired. It notifies NOBODY; that is the other route.
 *
 * Server-to-server / operator surface, like `admin/boards`: deliberately NO CORS
 * headers, and every request gated by `verifyAlertsSecret`, which distinguishes
 * unconfigured (503 — not provisioned, a server condition) from unauthorized
 * (401).
 *
 * ── WHY THE PROBE AND THE NOTIFY ARE TWO CALLS ─────────────────────────────
 * One endpoint could measure and notify in a single request, and it would be
 * less code. Two things are worth the extra round trip:
 *
 *   1. THE PROBE IS SAFE TO CALL. It reads counts and writes nothing, so it can
 *      be run by hand at a terminal, from `workflow_dispatch`, or from a
 *      dashboard panel later, without anybody wondering whether they just
 *      buzzed a phone. Every alerting system needs a way to ask "what would you
 *      say right now?" and get an answer rather than a notification.
 *   2. THE DECISION TO SPEAK IS EXPLICIT. The runner posts back the alerts it
 *      received; nothing fires as a side effect of somebody looking.
 *
 * The gate and the wire shapes both live in `app/lib/alerts/http.ts`, shared
 * with the notify half so the two cannot drift on who is let in.
 *
 * ── THE SNAPSHOT IS RETURNED, NOT JUST THE VERDICT ─────────────────────────
 * A quiet answer is the one you end up mistrusting — "no alerts" reads the same
 * whether the site is calm or the query is measuring the wrong thing. Returning
 * the counts it judged means the Actions log carries the evidence for every
 * silent run, so "why did this not fire?" is answerable from the log rather than
 * from a reconstruction six hours later.
 */

import {
  alertsAuthGate,
  alertsError,
  type AlertProbeResponse,
} from "@/app/lib/alerts/http";
import { getAlertSnapshot } from "@/app/lib/alerts/metrics";
import { evaluateAlerts } from "@/app/lib/alerts/rules";

export async function GET(req: Request): Promise<Response> {
  const denied = alertsAuthGate(req.headers);
  if (denied) return denied;

  const measured = await getAlertSnapshot();
  if (!measured.ok) {
    // 503 rather than 500: the site is fine, its ability to read its own
    // analytics is not. The runner turns this into a red CI run — see
    // `metrics.ts` for why this path must never degrade to "no alerts".
    return alertsError(measured.reason, 503);
  }

  const response: AlertProbeResponse = {
    ok: true,
    snapshot: measured.snapshot,
    alerts: evaluateAlerts(measured.snapshot),
  };
  return Response.json(response, { status: 200 });
}
