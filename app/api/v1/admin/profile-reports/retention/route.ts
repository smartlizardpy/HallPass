/**
 * Profile-report retention sweep — `POST /api/v1/admin/profile-reports/retention`.
 *
 * Deletes RESOLVED (actioned or dismissed) profile reports
 * `PROFILE_REPORT_RETENTION_DAYS` after they were resolved. Open reports are
 * never touched. Driven daily by `.github/workflows/clip-retention.yml` (a second
 * step, so the beta-clip sweep and this one fail and report separately) through
 * `scripts/run-profile-report-retention.mjs`.
 *
 * Same arrangement as `admin/beta/clip-retention`: `alertsAuthGate`
 * (`Authorization: Bearer ALERTS_SECRET`), a body that carries no ids and no
 * window (the cutoff is the constant in `app/lib/profile-reports/config.ts`), and
 * `{ "dryRun": true }` to count what is due without deleting. Deleting is
 * idempotent, so a leaked secret can at worst run the sweep early or repeatedly.
 *
 * A missing `profile_reports` table (migration 043 not applied) answers 503
 * naming the migration, as the clip route does for 044: the caller is a CI job
 * whose purpose is to be seen failing.
 */

import { alertsAuthGate, alertsError } from "@/app/lib/alerts/http";
import { isMissingColumnError } from "@/app/lib/db";
import { profileReports } from "@/app/lib/profile-reports";
import { PROFILE_REPORT_RETENTION_DAYS } from "@/app/lib/profile-reports/config";

export async function POST(req: Request): Promise<Response> {
  const denied = alertsAuthGate(req.headers);
  if (denied) return denied;

  let dryRun = false;
  try {
    dryRun = ((await req.json()) as { dryRun?: unknown } | null)?.dryRun === true;
  } catch {
    dryRun = false;
  }

  try {
    if (dryRun) {
      const due = await profileReports.countPurgeable(PROFILE_REPORT_RETENTION_DAYS);
      return Response.json({
        ok: true,
        dryRun: true,
        retentionDays: PROFILE_REPORT_RETENTION_DAYS,
        due,
        deleted: 0,
      });
    }
    const { deleted } = await profileReports.purgeResolved(PROFILE_REPORT_RETENTION_DAYS);
    return Response.json({
      ok: true,
      dryRun: false,
      retentionDays: PROFILE_REPORT_RETENTION_DAYS,
      due: deleted,
      deleted,
    });
  } catch (error) {
    if (isMissingColumnError(error)) {
      return alertsError(
        "profile_reports is missing - apply scoreboard/migrations/043_profile_reports.sql",
        503,
      );
    }
    console.error("profile-report retention sweep failed:", error);
    return alertsError("Could not delete expired profile reports", 500);
  }
}
