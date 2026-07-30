"use server";

/**
 * HallPass dashboard — player-flair server actions (admin).
 *
 * The WRITE half of the flair surface; the read-only list lives in `page.tsx`.
 * Control flow mirrors every other dashboard action: `requireRole("admin")` first
 * (fails closed), validate the inputs, wrap the single fallible store write in a
 * try/catch, and issue `redirect()` OUTSIDE that try — `redirect()` reports via a
 * thrown control signal a catch-all would otherwise swallow.
 *
 * A flair targets a PLAYER, not a dashboard user, so the admin addresses it the
 * way everyone else does — by `@username` — and this file resolves that to the
 * internal player id via `social.internalIdFromUsername`. That id is the Google
 * subject for a minor: it lives in a local `const` for exactly one store call and
 * is never redirected into a URL or returned.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { flair } from "@/app/lib/flair-store";
import { normalizeFlairInput, type FlairInputError } from "@/app/lib/flair";
import { social } from "@/app/lib/social";

const FLAIR_PATH = "/dashboard/flair";

/** Build a `?ok`/`?error` redirect target back to the flair manager. */
function back(key: "ok" | "error", message: string): never {
  redirect(`${FLAIR_PATH}?${key}=${encodeURIComponent(message)}`);
}

/** Human sentence for each rejection {@link normalizeFlairInput} can return. */
const INPUT_ERROR: Record<FlairInputError, string> = {
  "empty-label": "Label can’t be empty.",
  "label-too-long": "Label is too long (max 24 characters).",
  "bad-tone": "Pick a valid colour.",
};

/**
 * Read a `@username` field the forgiving way: trim, drop a leading "@" if the
 * admin typed one, and lowercase (usernames are stored lowercase, so the lookup
 * is a plain equality that hits the UNIQUE index). Returns "" for a blank field.
 */
function readUsername(formData: FormData): string {
  return String(formData.get("username") ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

/**
 * Grant a flair to the player behind `@username`. Resolves the username to a
 * player id, validates the label/icon/tone, then writes — idempotent on
 * (player, label), so a repeat is reported rather than stacked. The acting
 * admin's email is recorded as `granted_by`.
 */
export async function grantFlairAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("admin");

  const username = readUsername(formData);
  if (!username) back("error", "Enter a username.");

  const parsed = normalizeFlairInput({
    label: String(formData.get("label") ?? ""),
    icon: String(formData.get("icon") ?? ""),
    tone: String(formData.get("tone") ?? ""),
  });
  if (!parsed.ok) back("error", INPUT_ERROR[parsed.reason]);

  // Resolve the username to a player id. The store read is the only fallible bit,
  // so it alone is wrapped; the not-found and success redirects stay OUTSIDE the
  // try, where `redirect()`'s thrown control signal is not swallowed by a catch.
  let playerId: string | null = null;
  let resolveFailed = false;
  try {
    playerId = await social.internalIdFromUsername(username);
  } catch {
    resolveFailed = true;
  }
  if (resolveFailed) back("error", "Grant failed (database error).");
  if (playerId === null) back("error", `No player found with username @${username}.`);

  let outcome: "granted" | "duplicate";
  try {
    outcome = await flair.grantFlair(playerId, parsed.value, actor);
  } catch {
    back("error", "Grant failed (database error).");
  }

  revalidatePath(FLAIR_PATH);
  back(
    "ok",
    outcome === "duplicate"
      ? `@${username} already has “${parsed.value.label}”.`
      : `Granted “${parsed.value.label}” to @${username}.`,
  );
}

/** Revoke a flair by its own id. Unknown/blank ids bounce back as an error. */
export async function revokeFlairAction(formData: FormData): Promise<void> {
  await requireRole("admin");

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) back("error", "Invalid flair.");

  let removed: boolean;
  try {
    removed = await flair.revokeFlair(id);
  } catch {
    back("error", "Revoke failed (database error).");
  }
  if (!removed) back("error", "That flair no longer exists.");

  revalidatePath(FLAIR_PATH);
  back("ok", "Revoked.");
}
