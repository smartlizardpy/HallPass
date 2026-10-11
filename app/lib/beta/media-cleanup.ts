/**
 * HallPass — deleting beta clips and screenshots: the 30-day sweep, and the
 * clean-up after a player deletes their account.
 *
 * PURE of `server-only`, the database and the Blob SDK, like `store.ts`: the
 * store and the blob remover are passed in, so `media-cleanup.test.ts` drives
 * every branch with fakes. The live wiring is `POST /api/v1/admin/beta/
 * clip-retention` (the sweep) and `deletePlayer` in `app/lib/players.ts`.
 *
 * ── WHAT IS DELETED ────────────────────────────────────────────────────────
 * A report's recording (`clip_blob_path`) and pinned screenshot
 * (`shot_blob_path`). Both are columns on `beta_reports`, so one query finds both
 * (`store.expiredMedia`). The report TEXT is never touched.
 *
 * ── ORDER: BLOB FIRST, ROW SECOND ──────────────────────────────────────────
 * The object is deleted before the pointer is cleared, never the other way round.
 * Clearing first would, after a failed delete, leave a recording of a child's
 * screen in Blob with nothing anywhere that points at it: unfindable and
 * unretryable. Blob first means every failure leaves a row that still names the
 * object, and the next run picks it up again:
 *
 *   * blob delete fails          -> row untouched, retried next run;
 *   * blob gone, row write fails -> retried next run; deleting an already-gone
 *     object counts as success, so the retry converges.
 *
 * ── AN ALREADY-GONE OBJECT MUST NOT WEDGE THE JOB ──────────────────────────
 * A fix or triage may have deleted it, or an operator did by hand. "Not found" is
 * the state we wanted, so it is treated as deleted and the pointer cleared.
 *
 * ── BEST-EFFORT PER ITEM, BOUNDED PER RUN ──────────────────────────────────
 * One bad row never stops the rest (each is its own try/catch), and a run handles
 * at most `limit` reports, oldest first, so a backlog drains over several days
 * instead of becoming one enormous request.
 */

import type { BetaStore } from "./store";

/** Deletes one Blob object by path. `del` from `@vercel/blob`, or a fake. */
export type BlobRemover = (path: string) => Promise<void>;

/** The slice of the store these functions use. */
export type MediaStore = Pick<
  BetaStore,
  "expiredMedia" | "markMediaExpired" | "mediaOwnedBy" | "deleteShots"
>;

/** Where a failure is reported. Defaults to the console, like `reportUnexpected`. */
export type MediaLog = (what: string, error: unknown) => void;

const defaultLog: MediaLog = (what, error) => console.error(`${what}:`, error);

/** True when an error from the Blob SDK means the object does not exist. */
export function isBlobGone(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return (
    name === "BlobNotFoundError" ||
    (typeof message === "string" && /not\s*found|does not exist|404/i.test(message))
  );
}

/**
 * Delete one object. Resolves `true` when it is gone afterwards (deleted now or
 * already absent), `false` on any other failure (logged). Never throws.
 */
export async function removeBlob(
  remove: BlobRemover,
  path: string,
  log: MediaLog = defaultLog,
): Promise<boolean> {
  try {
    await remove(path);
    return true;
  } catch (error) {
    if (isBlobGone(error)) return true;
    log(`beta media delete failed for ${path}`, error);
    return false;
  }
}

export type SweepResult = {
  /** Reports the query returned this run (at most `limit`). */
  considered: number;
  /** Reports whose media pointers were cleared. */
  cleared: number;
  /** Blob objects removed (or found already gone). */
  blobsRemoved: number;
  /** Reports with an object or row write that failed; the next run retries them. */
  failed: number;
  /** True when the batch was full, i.e. more may be waiting for the next run. */
  more: boolean;
};

/**
 * Remove one report's objects, then clear the pointers of whichever succeeded.
 * Returns how many objects went and whether anything was left to retry. A throw
 * from the row write propagates to the caller's per-item catch.
 */
async function clearReportMedia(
  store: Pick<MediaStore, "markMediaExpired">,
  remove: BlobRemover,
  report: { id: number; clipBlobPath: string | null; shotBlobPath: string | null },
  log: MediaLog,
): Promise<{ removed: number; incomplete: boolean }> {
  const clip = report.clipBlobPath ? await removeBlob(remove, report.clipBlobPath, log) : false;
  const shot = report.shotBlobPath ? await removeBlob(remove, report.shotBlobPath, log) : false;
  // Clears only what was actually removed; a failed half stays pointed at.
  if (clip || shot) await store.markMediaExpired(report.id, { clip, shot });
  return {
    removed: Number(clip) + Number(shot),
    incomplete: Boolean(report.clipBlobPath && !clip) || Boolean(report.shotBlobPath && !shot),
  };
}

/**
 * Delete the media of reports older than `days`, at most `limit` reports.
 *
 * THROWS only if the selection query itself fails (the caller reports that as a
 * failed run); everything after it is per-item and swallowed into `failed`.
 */
export async function sweepExpiredMedia(input: {
  store: Pick<MediaStore, "expiredMedia" | "markMediaExpired">;
  remove: BlobRemover;
  days: number;
  limit: number;
  log?: MediaLog;
}): Promise<SweepResult> {
  const log = input.log ?? defaultLog;
  const due = await input.store.expiredMedia(input.days, input.limit);
  const result: SweepResult = {
    considered: due.length,
    cleared: 0,
    blobsRemoved: 0,
    failed: 0,
    more: due.length >= input.limit,
  };

  for (const report of due) {
    try {
      const { removed, incomplete } = await clearReportMedia(
        input.store,
        input.remove,
        report,
        log,
      );
      result.blobsRemoved += removed;
      if (removed > 0) result.cleared += 1;
      if (incomplete) result.failed += 1;
    } catch (error) {
      result.failed += 1;
      log(`beta media sweep failed for report ${report.id}`, error);
    }
  }
  return result;
}

/** What `store.mediaOwnedBy` returned, read before the player row was deleted. */
export type OwnedMedia = Awaited<ReturnType<MediaStore["mediaOwnedBy"]>>;

/**
 * Delete the media a deleted player owned, AFTER their row is gone.
 *
 * `owned` must have been read BEFORE the delete (the reports' `player_id` is
 * nulled by it). Never throws: account deletion has already succeeded and must
 * not be reported as failed because a Blob call did. A report whose delete fails
 * keeps its pointer, so the 30-day sweep removes it later: the sweep is the safety
 * net for this path. Staged `beta_shots` have no such net, so a failure there is
 * only logged.
 */
export async function removeOwnedMedia(input: {
  store: Pick<MediaStore, "markMediaExpired" | "deleteShots">;
  remove: BlobRemover;
  owned: OwnedMedia;
  log?: MediaLog;
}): Promise<{ removed: number; failed: number }> {
  const log = input.log ?? defaultLog;
  let removed = 0;
  let failed = 0;

  for (const report of input.owned.reports) {
    try {
      const outcome = await clearReportMedia(input.store, input.remove, report, log);
      removed += outcome.removed;
      if (outcome.incomplete) failed += 1;
    } catch (error) {
      failed += 1;
      log(`beta media clean-up failed for report ${report.id}`, error);
    }
  }

  const goneShots: string[] = [];
  for (const shot of input.owned.shots) {
    if (await removeBlob(input.remove, shot.blobPath, log)) {
      goneShots.push(shot.id);
      removed += 1;
    } else {
      failed += 1;
    }
  }
  try {
    await input.store.deleteShots(goneShots);
  } catch (error) {
    failed += 1;
    log("beta staged shot rows could not be removed", error);
  }

  return { removed, failed };
}
