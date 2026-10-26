"use server";

/**
 * HallPass dashboard — Candy Hunt server actions (`/dashboard/candy`).
 *
 * The house shape of `collectibles/actions.ts`, with one difference: SUPER ADMIN
 * only. Candy decides what players can buy, so setting a value or revoking a
 * credit is not an `admin` job.
 *
 *   1. `requireRole("super_admin")` FIRST, before any form field is read. Server
 *      actions are reachable by direct POST; this is the gate.
 *   2. Validate every field (ids against their format, the value against 0 to the
 *      ceiling, the reason present). A bad value is a banner, never a 500 and
 *      never an unchecked value reaching Postgres.
 *   3. A tight `try` around the store calls only.
 *   4. `redirect()` OUTSIDE that `try` (it throws to navigate).
 *   5. `revalidatePath` before the success redirect.
 *
 * The actor is `requireRole()`'s email, never a form field. The store writes the
 * `candy_log` row in the same statement as the change.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { CANDY, candyStore } from "@/app/lib/candy";
import { isAchievementCandy } from "@/app/lib/candy/fright-fest-2026";

const PATH = "/dashboard/candy";
const MAX_REASON = 500;
const DB_HINT = "database error; is migration 050_candy.sql applied?";
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Back to the page, keeping the game filter the admin was on. */
function back(kind: "ok" | "error", message: string, game?: string | null): never {
  const filter = game && SLUG_RE.test(game) ? `game=${game}&` : "";
  redirect(`${PATH}?${filter}${kind}=${encodeURIComponent(message)}`);
}

const readGame = (formData: FormData): string | null => {
  const g = String(formData.get("game") ?? "").trim();
  return g && SLUG_RE.test(g) ? g : null;
};

export async function setCandyValueAction(formData: FormData): Promise<void> {
  const { email } = await requireRole("super_admin");
  const game = readGame(formData);
  const rawId = String(formData.get("achievementId") ?? "").trim();
  const achievementId = /^\d{1,15}$/.test(rawId) ? Number(rawId) : NaN;
  if (!Number.isSafeInteger(achievementId) || achievementId <= 0) back("error", "That achievement id was not valid.", game);

  // A typed number wins over the preset picker; at least one is required.
  const typed = String(formData.get("candy") ?? "").trim();
  const preset = String(formData.get("preset") ?? "").trim();
  const raw = typed !== "" ? typed : preset;
  if (raw === "") back("error", "Pick a rubric value or type a number.", game);
  const candy = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!isAchievementCandy(CANDY, candy)) back("error", `Candy must be a whole number from 0 to ${CANDY.maxAchievementCandy}.`, game);

  let outcome: "changed" | "unchanged" | "not-found" | null = null;
  try {
    outcome = await candyStore.setAchievementCandy({ achievementId, candy, actorEmail: email });
  } catch (error) {
    console.error("[candy] set value failed", error);
  }
  if (outcome === null) back("error", `Could not save the value (${DB_HINT}).`, game);
  if (outcome === "not-found") back("error", "No such achievement.", game);
  if (outcome === "unchanged") back("ok", `Already ${candy}: nothing changed.`, game);
  revalidatePath(PATH);
  back("ok", `Set to ${candy} candy. Players who unlocked it earlier are paid at their next sync; credits already made keep their amount.`, game);
}

export async function revokeCreditAction(formData: FormData): Promise<void> {
  const { email } = await requireRole("super_admin");
  const game = readGame(formData);
  const rawId = String(formData.get("ledgerId") ?? "").trim();
  const ledgerId = /^\d{1,15}$/.test(rawId) ? Number(rawId) : NaN;
  if (!Number.isSafeInteger(ledgerId) || ledgerId <= 0) back("error", "That credit id was not valid.", game);
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) back("error", "Give a reason: it goes in the audit log.", game);
  if (reason.length > MAX_REASON) back("error", `The reason is too long (at most ${MAX_REASON} characters).`, game);

  let changed: boolean | null = null;
  try {
    changed = await candyStore.revokeCredit({ ledgerId, actorEmail: email, reason });
  } catch (error) {
    console.error("[candy] revoke failed", error);
  }
  if (changed === null) back("error", `Could not revoke credit #${ledgerId} (${DB_HINT}).`, game);
  if (!changed) back("error", `Credit #${ledgerId} was not changed: no such credit, a spend (spends are final), or already revoked.`, game);
  revalidatePath(PATH);
  back("ok", `Credit #${ledgerId} revoked. The player's balance is lower by that amount, and may now be negative.`, game);
}
