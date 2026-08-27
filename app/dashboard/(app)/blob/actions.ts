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
  ADVANCED_BLOB_OPS,
  APP_SETTINGS_CACHE_TAG,
  blobOpDisabledMessage,
  isBlobOpEnabled,
  setAllBlobOps,
  setBlobOpEnabled,
  type BlobOpId,
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
 * Narrow a form value to a known switch id.
 *
 * The registry is the allow-list, so a hand-crafted POST cannot write an
 * arbitrary `blob_op:<anything>` key into `app_settings` — it would be inert,
 * but a settings table full of junk keys is exactly the kind of thing nobody
 * notices until they are debugging something else.
 */
function toBlobOpId(value: FormDataEntryValue | null): BlobOpId | null {
  const id = String(value ?? "");
  return ADVANCED_BLOB_OPS.some((op) => op.id === id) ? (id as BlobOpId) : null;
}

/**
 * Flip one feature's switch. The form submits the CURRENT state and this writes
 * the opposite, so the button is a toggle rather than two near-identical forms.
 *
 * `updateTag` is what makes the page show the new state immediately: every gated
 * action and the page itself read `app_settings` through one cached entry with an
 * hour-long backstop, so without this the operator would flip a switch and watch
 * nothing change.
 */
export async function toggleBlobOpAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("super_admin");

  const id = toBlobOpId(formData.get("id"));
  if (!id) back("error", "Unknown operation.");

  // The checkbox-less form posts what the page rendered; "1" means it is on now
  // and the click means turn it off.
  const enable = String(formData.get("enabled") ?? "") !== "1";

  const op = ADVANCED_BLOB_OPS.find((candidate) => candidate.id === id)!;
  let saved = false;
  try {
    await setBlobOpEnabled(id, enable, actor);
    saved = true;
  } catch {
    saved = false;
  }
  if (saved) updateTag(APP_SETTINGS_CACHE_TAG);

  back(
    saved ? "ok" : "error",
    saved
      ? `${op.label} is now ${enable ? "ON" : "OFF"}.`
      : `Could not save that switch. ${op.label} is unchanged.`,
  );
}

/**
 * Turn EVERY feature off, or every feature back on — the panic button for the
 * day the allowance reads 100%, and the single click that undoes it afterwards.
 *
 * One statement rather than a loop, so the switches can never end up half
 * applied: an operator who pressed "disable everything" and got five of seven
 * would have no way to tell which two were still spending.
 */
export async function setAllBlobOpsAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("super_admin");

  const enable = String(formData.get("enabled") ?? "") === "1";

  let saved = false;
  try {
    await setAllBlobOps(enable, actor);
    saved = true;
  } catch {
    saved = false;
  }
  if (saved) updateTag(APP_SETTINGS_CACHE_TAG);

  back(
    saved ? "ok" : "error",
    saved
      ? enable
        ? "Every advanced-blob feature is back ON."
        : "Every advanced-blob feature is OFF. Nothing in the app will spend an advanced operation."
      : "Could not save those switches. Nothing changed.",
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
