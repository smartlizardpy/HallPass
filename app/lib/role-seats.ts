/**
 * HallPass dashboard — the seat limits, as stored.
 *
 * How many people may hold each dashboard role is a number a super admin edits
 * (`/dashboard/users/settings`), not one a deploy changes. Each limit is one
 * `role_seats:<role>` row in `app_settings`; the DEFAULTS and every pure
 * question asked about a limit live in `app/lib/permissions.ts`, and this module
 * is only the storage between them.
 *
 * MISSING ROW MEANS DEFAULT, per row. That is the `app_settings` contract, and
 * applying it one value at a time rather than all-or-nothing is what lets a
 * deployment that has only ever raised the beta-admin cap keep the shipped
 * defaults for the other two — and what makes a database nobody has touched the
 * settings on behave exactly like a fresh one.
 *
 * READ FAILURE MEANS DEFAULT TOO, and that is the safe direction on purpose.
 * `readAppSettings` is already fail-soft to an empty map, so an unreachable
 * database leaves this returning the tightest known caps. The alternative
 * readings are both worse: throwing would take down a page whose other half
 * (the user list) has its own error state, and treating "unknown" as "uncapped"
 * would hand out access precisely when nothing can be verified.
 *
 * WHY THE LIMITS ARE READ AND NOT PASSED IN. `addUser`/`setRole` call
 * {@link readSeatLimits} themselves rather than taking a limit from the caller,
 * so there is no call site that can be written — or rewritten later — with a
 * limit of its own. The read is cached (`unstable_cache`, invalidated by the
 * write below), so on the common path it costs nothing.
 */

import "server-only";
import {
  readAppSettings,
  writeAppSettings,
  APP_SETTINGS_CACHE_TAG,
} from "@/app/lib/app-settings";
import {
  ROLES,
  roleSeatsKey,
  toSeatLimits,
  type SeatLimits,
} from "@/app/lib/permissions";

export { APP_SETTINGS_CACHE_TAG };

/**
 * The limits in force, with each role's default where nothing valid is stored.
 *
 * Never rejects — see the module docblock for why "unknown" reads as the
 * defaults rather than as an error or as no cap.
 */
export async function readSeatLimits(): Promise<SeatLimits> {
  const settings = await readAppSettings();
  return toSeatLimits((role) => settings.get(roleSeatsKey(role)));
}

/**
 * Save every limit, in one statement.
 *
 * All three go together rather than one key per call, because the settings form
 * posts all three: written separately over the HTTP driver they would be three
 * round trips and could half-apply, leaving a cap somebody did not choose.
 *
 * THROWS on failure, like the settings writes it delegates to. A limit that
 * silently failed to save is worse than an error banner — the operator would
 * believe they had raised a cap and only find out when a grant is refused.
 *
 * Values are narrowed by the CALLER (`settings/actions.ts`) before they get
 * here; they are written as decimal text, which is what `toSeatLimit` reads back.
 */
export async function writeSeatLimits(
  limits: SeatLimits,
  actor: string | null,
): Promise<void> {
  await writeAppSettings(
    ROLES.map((role) => [roleSeatsKey(role), String(limits[role])] as const),
    actor,
  );
}
