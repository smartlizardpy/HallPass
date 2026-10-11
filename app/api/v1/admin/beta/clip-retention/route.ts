/**
 * Beta media retention sweep — `POST /api/v1/admin/beta/clip-retention`.
 *
 * Deletes the clips and screenshots attached to beta reports once they are
 * `CLIP_RETENTION_DAYS` old. Driven daily by `.github/workflows/clip-retention.yml`
 * through `scripts/run-clip-retention.mjs`; like the site alerts and the streak
 * reminders, nothing on a serverless deployment wakes up to do this by itself.
 *
 * ── THE RUNNER DECIDES NOTHING ─────────────────────────────────────────────
 * The body carries no ids, no paths and no window. The cutoff is the constant in
 * `app/lib/beta/config.ts` and the rows are chosen here, so a leaked secret can
 * at worst trigger the sweep early or repeatedly, and "repeatedly" deletes
 * nothing more than the first run did. It authenticates exactly as the other
 * scheduled jobs do (`alertsAuthGate`: `Authorization: Bearer ALERTS_SECRET`).
 *
 * ── WHAT A RUN DOES, AND WHAT IT SURVIVES ──────────────────────────────────
 * See `app/lib/beta/media-cleanup.ts`: blob first, row second, per-item
 * best-effort, bounded to `MEDIA_SWEEP_BATCH` reports per run (oldest first).
 * `more: true` means the batch was full and the next run continues. A run where
 * individual items failed still answers 200 with `failed > 0` (the runner turns
 * that into a warning); only an unreadable queue is an error.
 *
 * `{ "dryRun": true }` reports how many reports are due and deletes nothing.
 *
 * A missing `media_expired_at` column (migration 042 not applied) answers 503
 * naming the migration: the caller is a CI job whose whole purpose is to be seen
 * failing, and "nothing to delete" every day for ever is the failure to avoid.
 */

import { del } from "@vercel/blob";
import { alertsAuthGate, alertsError } from "@/app/lib/alerts/http";
import { beta } from "@/app/lib/beta";
import { CLIP_RETENTION_DAYS, MEDIA_SWEEP_BATCH } from "@/app/lib/beta/config";
import { sweepExpiredMedia } from "@/app/lib/beta/media-cleanup";
import { isMissingColumnError } from "@/app/lib/db";

/**
 * The longest this route may run, in seconds (Route Segment Config, see
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`).
 * A full batch is up to 2 x `MEDIA_SWEEP_BATCH` Blob deletes and one UPDATE per
 * report, sequential; 60s matches the runner's request timeout so both give up
 * together.
 */
export const maxDuration = 60;

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
      const due = await beta.expiredMedia(CLIP_RETENTION_DAYS, MEDIA_SWEEP_BATCH);
      return Response.json({
        ok: true,
        dryRun: true,
        retentionDays: CLIP_RETENTION_DAYS,
        batch: MEDIA_SWEEP_BATCH,
        considered: due.length,
        cleared: 0,
        blobsRemoved: 0,
        failed: 0,
        more: due.length >= MEDIA_SWEEP_BATCH,
      });
    }

    const result = await sweepExpiredMedia({
      store: beta,
      remove: async (path) => {
        await del(path);
      },
      days: CLIP_RETENTION_DAYS,
      limit: MEDIA_SWEEP_BATCH,
    });
    return Response.json({
      ok: true,
      dryRun: false,
      retentionDays: CLIP_RETENTION_DAYS,
      batch: MEDIA_SWEEP_BATCH,
      ...result,
    });
  } catch (error) {
    if (isMissingColumnError(error)) {
      return alertsError(
        "beta_reports.media_expired_at is missing - apply scoreboard/migrations/042_beta_media_expiry.sql",
        503,
      );
    }
    console.error("beta clip-retention sweep failed:", error);
    return alertsError("Could not read which clips are due for deletion", 500);
  }
}
