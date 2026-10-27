"use server";

/**
 * The games' Halloween switch: `auto` (follow the event's dates) | `off` (the
 * event does not exist in any game). Super admin only, like BoardPass: it changes
 * what every player sees at once. Follows `boardpass/actions.ts` — the role is
 * re-resolved on the click, the value is narrowed before it is written, and a
 * failed write is reported rather than swallowed.
 */

import { redirect } from "next/navigation";
import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/app/lib/auth";
import { APP_SETTINGS_CACHE_TAG, writeAppSetting } from "@/app/lib/app-settings";
import { getUserRole } from "@/app/lib/dashboard-users";
import { GAME_EVENT_MODES, GAME_EVENT_MODE_KEY, type GameEventMode } from "@/app/lib/events/game-event";

const PATH = "/dashboard/events";

function back(kind: "ok" | "error", message: string): never {
  redirect(`${PATH}?${kind}=${encodeURIComponent(message)}`);
}

export async function setGameEventModeAction(form: FormData): Promise<void> {
  const session = await auth().catch(() => null);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) redirect("/dashboard/signin");

  const role = await getUserRole(email).catch(() => null);
  if (role !== "super_admin") back("error", "Only a super admin can change the Halloween event.");

  const raw = String(form.get("mode") ?? "");
  if (!(GAME_EVENT_MODES as readonly string[]).includes(raw)) back("error", "That is not a valid setting.");

  try {
    await writeAppSetting(GAME_EVENT_MODE_KEY, raw as GameEventMode, email);
  } catch (error) {
    console.error("Failed to write the game event mode:", error);
    back("error", "That setting could not be saved. Try again.");
  }
  updateTag(APP_SETTINGS_CACHE_TAG);
  revalidatePath(PATH);
  back(
    "ok",
    raw === "off"
      ? "Halloween is OFF. Games will drop it within about a minute."
      : "Halloween is ON (it follows the event dates).",
  );
}
