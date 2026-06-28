"use server";

/**
 * HallPass dashboard — user/role management server actions (super-admin only).
 *
 * These are the WRITE half of the user-management surface; the read-only server
 * component that lists users lives alongside in `users/page.tsx`. Every action
 * fails closed: `requireRole("super_admin")` runs FIRST and redirects a caller
 * who is not a super admin before any form field is read or any row is written.
 *
 * Two invariants are enforced here, not in the store, because they are policy
 * about the env allow-list rather than data shape:
 *   - The env-driven super admins (`SUPER_ADMIN_EMAILS`, see
 *     `isSuperAdminEmail`) are immutable from the UI: their role is asserted on
 *     every login and a row delete would simply be re-created, so we reject both
 *     `setRole` and `removeUser` against them with a clear message instead of
 *     pretending to act.
 *   - Invited emails are normalised to `.trim().toLowerCase()` and shape-checked
 *     before they reach the store, so the PRIMARY KEY stays canonical and an
 *     obviously bogus address bounces back to the form rather than creating a
 *     junk row that can never sign in.
 *
 * Result reporting uses the querystring: `?ok=<message>` / `?error=<message>`
 * are full human-readable sentences (the page renders them verbatim in a banner).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import {
  addAdmin,
  setRole,
  removeUser,
  isSuperAdminEmail,
  type Role,
} from "@/app/lib/dashboard-users";

/** Where every action lands; centralised so the path never drifts. */
const USERS_PATH = "/dashboard/users";

/** A deliberately permissive "looks like an email" shape check. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Pull the `email` field, normalised to the store's canonical form. */
function readEmail(formData: FormData): string {
  return String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
}

/** Redirect back to the users page carrying a banner message. */
function back(kind: "ok" | "error", message: string): never {
  redirect(`${USERS_PATH}?${kind}=${encodeURIComponent(message)}`);
}

/**
 * Invite (or re-assert) an `admin` by email. The acting super admin's address is
 * recorded as the inviter. A missing or malformed address bounces back to the
 * form; a valid one is upserted and the list revalidated.
 */
export async function addAdminAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("super_admin");

  const email = readEmail(formData);
  if (!email || !EMAIL_SHAPE.test(email)) {
    back("error", "Invalid email");
  }
  // Env super admins are governed by SUPER_ADMIN_EMAILS, not this table; inviting
  // one as an 'admin' would only write a misleading row (their effective role is
  // still super_admin via the allow-list). Reject it for clarity.
  if (isSuperAdminEmail(email)) {
    back("error", "That address is an env super admin");
  }

  // Only the store write can throw on a down/unconfigured DB; keep it INSIDE the
  // try so a raw 500 becomes a banner. The success back() (a redirect) must stay
  // OUTSIDE — redirect() throws a control signal that this catch would swallow.
  try {
    await addAdmin(email, actor);
  } catch {
    back("error", "Add admin failed (database error)");
  }
  revalidatePath(USERS_PATH);
  back("ok", "Added");
}

/**
 * Set an existing user's role outright. Env super admins are immutable from the
 * UI, so an attempt to change one is rejected before touching the store.
 */
export async function setRoleAction(formData: FormData): Promise<void> {
  await requireRole("super_admin");

  const email = readEmail(formData);
  // Validate the role against the whitelist BEFORE the store — an unchecked cast
  // would let a malformed/missing value reach the NOT NULL/CHECK column and throw
  // a raw 500 instead of a graceful banner.
  const roleRaw = formData.get("role");
  if (roleRaw !== "admin" && roleRaw !== "super_admin") {
    back("error", "Invalid role");
  }
  const role: Role = roleRaw;

  if (isSuperAdminEmail(email)) {
    back("error", "Cannot change an env super admin");
  }

  // See addAdminAction: wrap only the store write so a DB error degrades to a
  // banner, leaving the success redirect outside the try where it belongs.
  try {
    await setRole(email, role);
  } catch {
    back("error", "Set role failed (database error)");
  }
  revalidatePath(USERS_PATH);
  back("ok", "Role updated");
}

/**
 * Revoke a user entirely. Env super admins cannot be removed from the UI (their
 * row would be re-created on next login), so the attempt is rejected up front.
 */
export async function removeUserAction(formData: FormData): Promise<void> {
  await requireRole("super_admin");

  const email = readEmail(formData);

  if (isSuperAdminEmail(email)) {
    back("error", "Cannot remove an env super admin");
  }

  // See addAdminAction: wrap only the store write so a DB error degrades to a
  // banner, leaving the success redirect outside the try where it belongs.
  try {
    await removeUser(email);
  } catch {
    back("error", "Remove user failed (database error)");
  }
  revalidatePath(USERS_PATH);
  back("ok", "Removed");
}
