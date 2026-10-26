"use server";

/**
 * HallPass dashboard — collectibles server actions (`/dashboard/collectibles`).
 *
 * The house shape of `championship/actions.ts`:
 *
 *   1. `requireRole("super_admin")` FIRST, before any form field is read.
 *      Server actions are reachable by direct POST; this is the gate. It is
 *      `super_admin`, not `SITE_WRITE_ROLE`: the owner wants grants and
 *      revocations limited to super admins. (Event rewards are paid by the
 *      championship desk, which calls the store directly at `SITE_WRITE_ROLE`
 *      and does not come through here.)
 *   2. Validate every field (pack id against the catalogue, ids against their
 *      format, the reason present). A bad value is a banner, never a 500 and
 *      never an unchecked value reaching Postgres.
 *   3. A tight `try` around the store calls only.
 *   4. `redirect()` OUTSIDE that `try` (it throws to navigate).
 *   5. `revalidatePath` before the success redirect.
 *
 * The actor is `requireRole()`'s email, never a form field. The store writes
 * the `collectibles_log` row in the same statement as the change.
 *
 * DOUBLE SUBMISSION. The grant form carries a nonce minted when the page was
 * rendered; the grant key is `admin:<nonce>`, so a double-click, a resubmit or
 * a back-button replay hits `ON CONFLICT (grant_key) DO NOTHING` and creates
 * one pack. A new page render is a new nonce, so a deliberate second grant is
 * just a second submit from a fresh page.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { collectiblesStore } from "@/app/lib/collectibles";
import { getPack } from "@/app/lib/collectibles/catalogue";
import { UUID_RE } from "@/app/lib/collectibles/store";

const PATH = "/dashboard/collectibles";
const MAX_REASON = 500;
const DB_HINT = "database error; is migration 049_collectibles.sql applied?";

function back(kind: "ok" | "error", message: string): never {
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

function readReason(formData: FormData): string {
  const raw = String(formData.get("reason") ?? "").trim();
  if (!raw) back("error", "Give a reason: it goes in the audit log.");
  if (raw.length > MAX_REASON) back("error", `The reason is too long (at most ${MAX_REASON} characters).`);
  return raw;
}

export async function grantPackAction(formData: FormData): Promise<void> {
  const { email } = await requireRole("super_admin");
  const query = String(formData.get("player") ?? "").trim();
  if (!query || query.length > 100) back("error", "Give a username or a public id.");
  const pack = getPack(String(formData.get("pack") ?? ""));
  if (!pack) back("error", "Unknown pack.");
  const nonce = String(formData.get("nonce") ?? "").trim();
  if (!UUID_RE.test(nonce)) back("error", "The form expired; reload the page and try again.");
  const reason = readReason(formData);

  let outcome: { found: false } | { found: true; name: string; publicId: string; created: boolean; packPublicId: string } | null = null;
  try {
    const player = await collectiblesStore.findPlayerForAdmin(query);
    if (!player) {
      outcome = { found: false };
    } else {
      const res = await collectiblesStore.adminGrantPack({
        playerId: player.playerId,
        packId: pack.id,
        grantKey: `admin:${nonce.toLowerCase()}`,
        source: "admin",
        actorEmail: email,
        reason,
      });
      outcome = { found: true, name: player.name, publicId: player.publicId, created: res.created, packPublicId: res.pack.publicId };
    }
  } catch (error) {
    console.error("[collectibles] grant failed", error);
  }
  if (!outcome) back("error", `Could not grant the pack (${DB_HINT}).`);
  if (!outcome.found) back("error", "No player has that username or public id.");
  if (!outcome.created) back("ok", `Already granted: pack ${outcome.packPublicId} went to ${outcome.name} on an earlier submit. Nothing new was created.`);
  revalidatePath(PATH);
  back("ok", `Granted ${pack.name} to ${outcome.name} (${outcome.publicId}). Pack id ${outcome.packPublicId}.`);
}

export async function revokePackAction(formData: FormData): Promise<void> {
  const { email } = await requireRole("super_admin");
  const publicId = String(formData.get("packId") ?? "").trim();
  if (!UUID_RE.test(publicId)) back("error", "That pack id was not valid.");
  const reason = readReason(formData);

  let changed: boolean | null = null;
  try {
    changed = await collectiblesStore.revokePack({ publicId, actorEmail: email, reason });
  } catch (error) {
    console.error("[collectibles] revoke pack failed", error);
  }
  if (changed === null) back("error", `Could not revoke the pack (${DB_HINT}).`);
  if (!changed) back("error", "Nothing changed: no such pack, or it was already opened or revoked. Opened packs are corrected one pull at a time.");
  revalidatePath(PATH);
  back("ok", `Pack ${publicId} revoked.`);
}

export async function revokePullAction(formData: FormData): Promise<void> {
  const { email } = await requireRole("super_admin");
  const raw = String(formData.get("pullId") ?? "").trim();
  const pullId = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(pullId) || pullId <= 0) back("error", "That pull id was not valid.");
  const reason = readReason(formData);

  let changed: boolean | null = null;
  try {
    changed = await collectiblesStore.revokePull({ pullId, actorEmail: email, reason });
  } catch (error) {
    console.error("[collectibles] revoke pull failed", error);
  }
  if (changed === null) back("error", `Could not revoke pull #${pullId} (${DB_HINT}).`);
  if (!changed) back("error", `Pull #${pullId} was not changed: no such pull, or it was already revoked.`);
  revalidatePath(PATH);
  back("ok", `Pull #${pullId} revoked; the card no longer counts as owned.`);
}
