"use server";

/**
 * The BoardPass rollout switch: `off` (default, a kill switch that also stops
 * live board sessions resolving) | `staff` | `on`. Super admin only — it changes
 * who can sign in to a shared screen. Follows `mcp/actions.ts`: the role is
 * re-resolved on the click, the value is narrowed before it is written, and a
 * failed write is reported rather than swallowed.
 */

import { redirect } from "next/navigation";
import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/app/lib/auth";
import { APP_SETTINGS_CACHE_TAG, writeAppSetting } from "@/app/lib/app-settings";
import { getUserRole } from "@/app/lib/dashboard-users";
import { BOARDPASS_MODES, BOARDPASS_MODE_KEY, type BoardPassMode } from "@/app/lib/boardpass/config";

const PATH = "/dashboard/boardpass";

function back(kind: "ok" | "error", message: string): never {
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

export async function setBoardPassModeAction(form: FormData): Promise<void> {
  const session = await auth().catch(() => null);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) redirect("/dashboard/signin");

  const role = await getUserRole(email).catch(() => null);
  if (role !== "super_admin") back("error", "Only a super admin can change BoardPass.");

  const raw = String(form.get("mode") ?? "");
  if (!(BOARDPASS_MODES as readonly string[]).includes(raw)) back("error", "That is not a BoardPass mode.");

  try {
    await writeAppSetting(BOARDPASS_MODE_KEY, raw as BoardPassMode, email);
  } catch (error) {
    console.error("Failed to write the BoardPass mode:", error);
    back("error", "That setting could not be saved. Try again.");
  }
  updateTag(APP_SETTINGS_CACHE_TAG);
  revalidatePath(PATH);
  back("ok", `BoardPass is now: ${raw}.`);
}
