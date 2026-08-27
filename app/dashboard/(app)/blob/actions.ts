"use server";

/**
 * HallPass dashboard — blob-operations control server actions (super-admin only).
 *
 * The WRITE half of `/dashboard/blob`; the read-only page that renders the
 * switches lives alongside in `page.tsx`.
 *
 * WHY SUPER ADMIN AND NOT ADMIN. Every switch here disables a surface OTHER
 * admins use — publishing a game, accepting a screenshot, uploading media. That
 * is an operator decision about the month's remaining allowance, not a content
 * decision, and it should sit with the same role that manages who can sign in at
 * all. `requireRole("super_admin")` runs FIRST in every action and redirects a
 * plain admin to `/dashboard` before any form field is read.
 *
 * Result reporting uses the querystring, like the users surface:
 * `?ok=<message>` / `?error=<message>` are full human-readable sentences the
 * page renders verbatim in a banner.
 *
 * Control-flow note (shared with every dashboard action): `redirect()` works by
 * THROWING a Next.js control signal, so it must never sit inside a `try`/`catch`
 * that swallows all errors. Each fallible write is wrapped tightly and reduced
 * to a boolean or a message; the `redirect()` reporting the outcome is issued
 * OUTSIDE that `try`.
 */

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import {
  APP_SETTINGS_CACHE_TAG,
  BLOB_READ_ONLY_NOTICE,
  allBlobOpSwitches,
  blobOpDisabledMessage,
  describeBlobOpChanges,
  diffBlobOpSwitches,
  isBlobOpEnabled,
  isBlobReadOnly,
  readBlobOpSwitches,
  setBlobOps,
  switchesFromEnabledIds,
} from "@/app/lib/blob-ops";
import {
  GAMES_BLOB_CACHE_TAG,
  reindexGameBlobs,
} from "@/app/lib/game-blob-index";

/** Where every action lands; centralised so the path never drifts. */
const BLOB_PATH = "/dashboard/blob";

/** Redirect back to the blob page carrying a banner message. */
function back(kind: "ok" | "error", message: string): never {
  redirect(`${BLOB_PATH}?${kind}=${encodeURIComponent(message)}`);
}

/**
 * Refuse a write while `BLOB_READ_ONLY` holds the switches shut.
 *
 * The page already disables the buttons, but that is UX and this is the actual
 * gate — and the failure it prevents is a specific, nasty one. Without it a
 * super admin could save `blob_op:game_source = "1"` into the table, be told
 * "Game source publishing is now ON", and watch it keep refusing, because the
 * env lock wins on every read. A switch that reports a state it does not have is
 * worse than a switch that will not move.
 */
function refuseWhileLocked(): void {
  if (isBlobReadOnly()) back("error", BLOB_READ_ONLY_NOTICE);
}

/**
 * Save the whole switch panel — the one write path behind `/dashboard/blob`.
 *
 * WHY ONE ACTION AND NOT SEVEN CLICKS. Turning a switch used to submit
 * immediately, so an operator stopping five features made five writes, five
 * redirects and five banners on the screen they opened because publishing had
 * already broken. The panel now stages every click in the browser and posts once.
 *
 * WHAT IT READS. The form's checkboxes name the switches that should be ON;
 * `switchesFromEnabledIds()` reads absence as OFF, which is the browser's own
 * rule and is only decodable because the registry is a closed set. The bulk
 * button submits `all=0`/`all=1` instead, and that WINS over the checkboxes:
 * "disable everything" has to stay one click on the day it is needed, so it
 * overrides whatever was staged rather than merging with it.
 *
 * WHAT IT WRITES. Only the switches that actually moved, in one statement. The
 * diff is what stops two super admins with the page open from clobbering each
 * other — a save that re-asserted all seven would silently undo the other's
 * change — and it is also what lets the banner name exactly what happened.
 *
 * A save that moves nothing is reported as such rather than written: the
 * operator either double-submitted or someone else got there first, and both
 * are worth saying instead of a "Saved." that saved nothing.
 */
export async function saveBlobOpsAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("super_admin");
  refuseWhileLocked();

  const all = String(formData.get("all") ?? "");
  const desired =
    all === "0" || all === "1"
      ? allBlobOpSwitches(all === "1")
      : switchesFromEnabledIds(formData.getAll("on").map(String));

  // The same read the page rendered from, so the diff is against what the
  // operator was actually looking at. It fails soft to all-enabled, which keeps
  // the bulk OFF button working during a Neon blip — the direction that matters.
  const changes = diffBlobOpSwitches(await readBlobOpSwitches(), desired);
  if (changes.length === 0) {
    back(
      "ok",
      "Nothing to save — every switch is already in the state you asked for.",
    );
  }

  let saved = false;
  try {
    await setBlobOps(changes, actor);
    saved = true;
  } catch {
    saved = false;
  }
  if (saved) updateTag(APP_SETTINGS_CACHE_TAG);

  back(
    saved ? "ok" : "error",
    saved
      ? describeBlobOpChanges(changes)
      : `Could not save. ${changes.length === 1 ? "That change was" : `All ${changes.length} changes were`} dropped and nothing moved.`,
  );
}

/**
 * Rebuild `game_blobs` from ONE paginated `list()` of the `games/` prefix.
 *
 * THE ONLY `list()` LEFT IN THE APP, and the reason the mirror is allowed to be
 * lossy rather than transactional: anything written out-of-band —
 * `publish-game.mjs` against a database it could not reach, a blob edited in the
 * Vercel dashboard, every override that predates migration 026 — is recoverable
 * by pressing this instead of by hand-writing rows.
 *
 * It is metered like everything else on this page, and it is the one entry an
 * operator should switch back ON first: an index that cannot be rebuilt is an
 * index that silently keeps serving the static twin.
 *
 * The banner reports what the sweep actually did. Somebody who has just spent a
 * scarce operation deserves to be told what it bought, and "indexed 41, removed
 * 3" is also the fastest way to notice that the mirror had drifted at all.
 */
export async function reindexBlobsAction(): Promise<void> {
  await requireRole("super_admin");
  // Before the registry check, so the banner names the ENV LOCK rather than
  // telling an operator to "re-enable it below" on switches they cannot move.
  refuseWhileLocked();

  if (!(await isBlobOpEnabled("blob_reindex"))) {
    back("error", blobOpDisabledMessage("blob_reindex"));
  }

  let result: { indexed: number; removed: number } | null = null;
  try {
    result = await reindexGameBlobs();
  } catch (err) {
    console.error("blob reindex failed:", err);
    result = null;
  }
  // Outside the try, because the sweep may have written rows before failing and
  // the page must not keep showing the pre-sweep count either way.
  updateTag(GAMES_BLOB_CACHE_TAG);

  if (!result) {
    back(
      "error",
      "The reindex sweep failed. If the advanced-operation allowance is spent, the list() itself is what failed — nothing was lost, try again after it resets.",
    );
  }
  back(
    "ok",
    `Rebuilt the index: ${result.indexed} blob${result.indexed === 1 ? "" : "s"} recorded, ${result.removed} stale row${result.removed === 1 ? "" : "s"} removed.`,
  );
}
