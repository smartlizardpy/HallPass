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
 * ── THE SNAPSHOT IS RETURNED, NOT JUST THE VERDICT ─────────────────────────
 * A quiet answer is the one you end up mistrusting — "no alerts" reads the same
 * whether the site is calm or the query is measuring the wrong thing. Returning
 * the counts it judged means the Actions log carries the evidence for every
 * silent run, so "why did this not fire?" is answerable from the log rather than
 * from a reconstruction six hours later.
 */

import { getAlertSnapshot } from "@/app/lib/alerts/metrics";
import { verifyAlertsSecret } from "@/app/lib/alerts/guard";
import { evaluateAlerts, type AlertSnapshot, type FiredAlert } from "@/app/lib/alerts/rules";
import type { ApiError } from "@/sdk/src/contract";

/** What a probe answers when it could measure. */
export type AlertProbeResponse = {
  ok: true;
  snapshot: AlertSnapshot;
  alerts: FiredAlert[];
};

/** Map the three auth outcomes to an early Response, or null to continue. */
function authGate(headers: Headers): Response | null {
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

export async function GET(req: Request): Promise<Response> {
  const denied = authGate(req.headers);
  if (denied) return denied;

  const measured = await getAlertSnapshot();
  if (!measured.ok) {
    // 503 rather than 500: the site is fine, its ability to read its own
    // analytics is not. The runner turns this into a red CI run — see
    // `metrics.ts` for why this path must never degrade to "no alerts".
    return Response.json({ error: measured.reason } satisfies ApiError, { status: 503 });
  }

  const response: AlertProbeResponse = {
    ok: true,
    snapshot: measured.snapshot,
    alerts: evaluateAlerts(measured.snapshot),
  };
  return Response.json(response, { status: 200 });
}
