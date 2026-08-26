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
  setAllBlobOps,
  setBlobOpEnabled,
  type BlobOpId,
} from "@/app/lib/blob-ops";

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
