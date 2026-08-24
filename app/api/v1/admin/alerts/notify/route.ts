/**
 * HallPass site alerts, half two — `POST /api/v1/admin/alerts/notify`.
 *
 * TAKES A MEASUREMENT AND TELLS THE ADMINS. The body is the `alerts` array the
 * probe answered, posted back by `scripts/check-alerts.mjs` once it has seen
 * something worth reporting. Same gate as the probe, same three outcomes.
 *
 * ── THE BODY CARRIES NUMBERS, NEVER WORDS ──────────────────────────────────
 * Every entry is narrowed by `parseFiredAlert` and the notification text is
 * built here, from the catalogue, by `alertCopy`. The credential that drives
 * this lives in a GitHub repository's settings — readable by anyone who can edit
 * a workflow file — so the difference matters: the worst a holder of the key can
 * do is claim a spike that did not happen, rather than put chosen text on an
 * admin's lock screen.
 *
 * ── ONE NOTIFICATION PER ALERT ID, PER REQUEST ─────────────────────────────
 * The body is deduped by id before anything is delivered. It bounds the work a
 * single request can ask for whatever arrives (a runaway runner posting ten
 * thousand entries costs three deliveries), and it matches what the cooldown
 * would do anyway — `alertDedupeKey` gives every entry with the same id the same
 * key, so the second would be dropped by the unique index a moment later.
 *
 * ── DELIVERY DOES NOT FAIL THIS REQUEST ────────────────────────────────────
 * `notifyAdmins` swallows its own failures by design (see `deliver.ts`): a
 * notification that could not be filed must never turn its producer into an
 * error. So a 200 here means "accepted and attempted", not "buzzed a phone" —
 * which is honest, because with the cooldown in play a perfectly healthy request
 * frequently and correctly delivers nothing at all.
 */

import { alertDedupeKey, type AlertId } from "@/app/lib/alerts/config";
import {
  alertsAuthGate,
  alertsError,
  type AlertNotifyResponse,
} from "@/app/lib/alerts/http";
import { parseFiredAlert, type FiredAlert } from "@/app/lib/alerts/rules";
import { alertCopy } from "@/app/lib/alerts/wording";
import { notifyAdmins } from "@/app/lib/notifications/deliver";

export async function POST(req: Request): Promise<Response> {
  const denied = alertsAuthGate(req.headers);
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return alertsError("Invalid JSON body", 400);
  }

  const submitted = (payload as { alerts?: unknown } | null)?.alerts;
  if (!Array.isArray(submitted)) {
    return alertsError("Expected { alerts: [...] } as returned by GET /api/v1/admin/alerts", 400);
  }

  // Narrow first, then dedupe by id, keeping the first of each — the runner
  // sends them in catalogue order, so the first is the one the probe reported.
  const byId = new Map<AlertId, FiredAlert>();
  for (const entry of submitted) {
    const alert = parseFiredAlert(entry);
    if (alert && !byId.has(alert.id)) byId.set(alert.id, alert);
  }
  const alerts = [...byId.values()];
  const rejected = submitted.length - alerts.length;

  // One clock reading for the whole request, so two alerts in the same batch
  // cannot land either side of a cooldown boundary.
  const now = Date.now();

  await Promise.all(
    alerts.map((alert) =>
      notifyAdmins({
        // An alert id IS a notification kind — `config.ts` makes that a build
        // guarantee rather than a convention.
        kind: alert.id,
        copy: alertCopy(alert),
        dedupeKey: alertDedupeKey(alert.id, now),
      }),
    ),
  );

  const response: AlertNotifyResponse = {
    ok: true,
    notified: alerts.map((alert) => alert.id),
    rejected,
  };
  return Response.json(response, { status: 200 });
}
