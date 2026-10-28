"use server";

/**
 * HallPass dashboard — referral server actions (`/dashboard/referrals`).
 *
 * SUPER ADMIN only, like the Candy desk: a referral pays candy, so changing the
 * bonus or revoking a payout is not an `admin` job. The house shape (see
 * `candy/actions.ts`): `requireRole` FIRST, validate every field, a tight `try`
 * around the store call, `redirect()` outside it. The actor is `requireRole()`'s
 * email, never a form field; the store writes the audit row in the same statement.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { referralStore } from "@/app/lib/referrals";

const PATH = "/dashboard/referrals";
const MAX_REASON = 500;
const DB_HINT = "database error; is migration 052_referrals.sql applied?";

function back(kind: "ok" | "error", message: string): never {
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

const whole = (raw: FormDataEntryValue | null, max: number): number => {
  const s = String(raw ?? "").trim();
  return /^\d{1,3}$/.test(s) && Number(s) <= max ? Number(s) : NaN;
};

export async function saveReferralSettingsAction(formData: FormData): Promise<void> {
  const { email } = await requireRole("super_admin");
  const bonus = whole(formData.get("bonus"), 100);
  const cap = whole(formData.get("cap"), 20);
  if (!Number.isInteger(bonus)) back("error", "The bonus must be a whole number from 0 to 100.");
  if (!Number.isInteger(cap)) back("error", "The cap must be a whole number from 0 to 20.");
  const enabled = formData.get("enabled") === "on";

  let saved: boolean | null = null;
  try {
    saved = await referralStore.setSettings({ enabled, bonus, cap, actorEmail: email });
  } catch (error) {
    console.error("[referrals] save settings failed", error);
  }
  if (saved === null) back("error", `Could not save the settings (${DB_HINT}).`);
  if (!saved) back("error", "Those settings were not valid.");
  revalidatePath(PATH);
  back("ok", `Saved: referrals ${enabled ? "on" : "off"}, ${bonus} candy each, at most ${cap} rewarded friends per player. Payouts already made keep their amount.`);
}

export async function revokeReferralAction(formData: FormData): Promise<void> {
  const { email } = await requireRole("super_admin");
  const rawId = String(formData.get("referralId") ?? "").trim();
  const referralId = /^\d{1,15}$/.test(rawId) ? Number(rawId) : NaN;
  if (!Number.isSafeInteger(referralId) || referralId <= 0) back("error", "That referral id was not valid.");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) back("error", "Give a reason: it goes in the audit log.");
  if (reason.length > MAX_REASON) back("error", `The reason is too long (at most ${MAX_REASON} characters).`);

  let changed: boolean | null = null;
  try {
    changed = await referralStore.revoke({ referralId, actorEmail: email, reason });
  } catch (error) {
    console.error("[referrals] revoke failed", error);
  }
  if (changed === null) back("error", `Could not revoke referral #${referralId} (${DB_HINT}).`);
  if (!changed) back("error", `Referral #${referralId} was not changed: it is not currently rewarded.`);
  revalidatePath(PATH);
  back("ok", `Referral #${referralId} revoked. Its candy stops counting and it keeps using the referrer's slot.`);
}
