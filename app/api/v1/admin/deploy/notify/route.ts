/**
 * HallPass deploy notifications — `POST /api/v1/admin/deploy/notify`.
 *
 * CALLED BY THE LAST STEP OF `.github/workflows/deploy.yml`, via
 * `scripts/notify-deploy.mjs`, once a production deploy is live. Body:
 * `{ sha, message }` — the deployed commit and its raw commit message. It tells
 * every admin that a new version shipped, and what.
 *
 * ── SAME GATE AS THE ALERTS ────────────────────────────────────────────────
 * `alertsAuthGate`, so the same `ALERTS_SECRET` opens it and the same three
 * outcomes apply (503 unconfigured, 401 wrong, through). A second secret would
 * be a second thing to provision and rotate for a request that can do no more
 * than file one admin-only notification.
 *
 * ── THE SERVER WORDS IT ────────────────────────────────────────────────────
 * The body carries a sha and a raw message; `parseDeployBody` narrows it and
 * `deployCopy` builds the text. See `app/lib/deploys/parse.ts` for why chosen
 * text is acceptable here when the alerts endpoint refuses it.
 *
 * ── ONE NOTIFICATION PER COMMIT ────────────────────────────────────────────
 * The dedupe key is the sha, so a re-run of the workflow or a `workflow_dispatch`
 * redeploy of the same commit files nothing and buzzes nobody. A 200 therefore
 * means "accepted and attempted", exactly as it does for the alerts: delivery
 * swallows its own failures (`deliver.ts`) and never turns the deploy's final
 * step into an error.
 */

import { alertsAuthGate, alertsError } from "@/app/lib/alerts/http";
import { deployDedupeKey, parseDeployBody } from "@/app/lib/deploys/parse";
import { notifyAdmins } from "@/app/lib/notifications/deliver";
import { deployCopy } from "@/app/lib/notifications/copy";

export async function POST(req: Request): Promise<Response> {
  const denied = alertsAuthGate(req.headers);
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return alertsError("Invalid JSON body", 400);
  }

  const deploy = parseDeployBody(payload);
  if (!deploy) {
    return alertsError("Expected { sha: <40-character commit sha>, message?: string }", 400);
  }

  await notifyAdmins({
    kind: "deploy_shipped",
    copy: deployCopy(deploy),
    dedupeKey: deployDedupeKey(deploy.sha),
  });

  return Response.json({ ok: true, sha: deploy.sha }, { status: 200 });
}
