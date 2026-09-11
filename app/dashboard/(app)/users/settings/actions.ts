"use server";

/**
 * HallPass dashboard — user settings (super-admin only).
 *
 * The WRITE half of `/dashboard/users/settings`. One action, one setting group:
 * how many people may hold each dashboard role. Like the user actions next door
 * it fails closed — `requireRole("super_admin")` runs FIRST, before any form
 * field is read — and reports through the querystring, which the page renders
 * verbatim in a banner.
 *
 * ── ALL THREE OR NONE ───────────────────────────────────────────────────────
 * Every limit is validated BEFORE anything is written, and one bad field
 * abandons the whole save. Writing the fields that parsed would leave the
 * operator looking at a form where some numbers changed and some did not, with
 * an error message that does not say which — and the two caps they can see are
 * then ones they did not choose together.
 *
 * ── LOWERING UNDER THE PEOPLE ALREADY THERE IS ALLOWED ──────────────────────
 * Deliberately not refused, and nobody is demoted by it. The role goes over
 * capacity, the Users page says so, and the role cannot be granted again until
 * it is back within its seats. Refusing instead would mean a shrinking team has
 * to remove people in an order the form dictates, and demoting somebody
 * automatically would let a number typed into a box take away access — the one
 * thing this surface should never do quietly.
 */

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import {
  ROLES,
  ROLE_LABEL,
  SEAT_MAX,
  SEAT_MIN,
  toSeatLimit,
  type SeatLimits,
} from "@/app/lib/permissions";
import {
  APP_SETTINGS_CACHE_TAG,
  readSeatLimits,
  writeSeatLimits,
} from "@/app/lib/role-seats";

/** Where the action lands; centralised so the path never drifts. */
const SETTINGS_PATH = "/dashboard/users/settings";

/** Redirect back to the settings page carrying a banner message. */
function back(kind: "ok" | "error", message: string): never {
  redirect(`${SETTINGS_PATH}?${kind}=${encodeURIComponent(message)}`);
}

/**
 * What was saved, spelled out — `"Saved: 1 super admin, 1 admin, 3 beta admins."`
 *
 * A bare "Saved" would be true of a typo as well, and the form is three numbers
 * whose whole purpose is to be checked. Reading them back is the cheapest
 * confirmation that the thing stored is the thing intended.
 */
function describeLimits(limits: SeatLimits): string {
  const parts = ROLES.map((role) => {
    const count = limits[role];
    const label = ROLE_LABEL[role].toLowerCase();
    return `${count} ${label}${count === 1 ? "" : "s"}`;
  });
  return `Saved: ${parts.join(", ")}.`;
}

/**
 * Save the seat limits.
 *
 * Fields are named by role (`seats:<role>` — see the form). A field that is
 * absent keeps its current value rather than resetting to the default, so a
 * partial POST cannot silently tighten a cap somebody raised on purpose.
 */
export async function setSeatLimitsAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("super_admin");

  // The limits in force are the base, so an absent field means "unchanged"
  // rather than "back to the shipped default". Never rejects — see
  // `role-seats.ts` — so it needs no try of its own.
  const current = await readSeatLimits();
  const limits: SeatLimits = { ...current };

  for (const role of ROLES) {
    const raw = formData.get(`seats:${role}`);
    if (raw == null) continue;
    const value = toSeatLimit(raw);
    // Narrowed, not cast, and REFUSED rather than clamped: a 500 quietly saved
    // as 50 reports success for a cap nobody chose.
    if (value === null) {
      back(
        "error",
        `${ROLE_LABEL[role]} seats must be a whole number between ` +
          `${SEAT_MIN} and ${SEAT_MAX}`,
      );
    }
    limits[role] = value;
  }

  // Nothing to do is said rather than reported as a save, the same way the blob
  // switches do it: "Saved" after a no-op teaches the operator that the button
  // always claims success, which is exactly when they stop reading it.
  if (ROLES.every((role) => limits[role] === current[role])) {
    back("ok", "Nothing to save — the limits are already what you asked for.");
  }

  // Only the write can throw; the success back() is a redirect (a thrown control
  // signal) and must stay outside the try that would otherwise swallow it.
  try {
    await writeSeatLimits(limits, actor);
  } catch {
    back("error", "Saving the limits failed and nothing changed.");
  }
  // Read-your-writes: the settings read is cached for an hour, so without this
  // the operator saves a limit and the page renders the old one back at them.
  // The Users page reads through the same cache, so one tag covers both.
  updateTag(APP_SETTINGS_CACHE_TAG);
  back("ok", describeLimits(limits));
}
