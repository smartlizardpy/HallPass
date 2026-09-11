"use server";

/**
 * HallPass dashboard — user/role management server actions (super-admin only).
 *
 * These are the WRITE half of the user-management surface; the read-only server
 * component that lists users lives alongside in `users/page.tsx`. Every action
 * fails closed: `requireRole("super_admin")` runs FIRST and redirects a caller
 * who is not a super admin before any form field is read or any row is written.
 *
 * Three invariants are enforced here, not in the store, because they are policy
 * about the env allow-list rather than data shape:
 *   - The env-driven super admins (`SUPER_ADMIN_EMAILS`, see
 *     `isSuperAdminEmail`) are immutable from the UI: their role is asserted on
 *     every login and a row delete would simply be re-created, so we reject both
 *     `setRole` and `removeUser` against them with a clear message instead of
 *     pretending to act.
 *   - Invite input is canonicalised and shape-checked before it reaches the
 *     store, so the PRIMARY KEY stays canonical and an obviously bogus value
 *     bounces back to the form rather than creating a junk row that can never
 *     sign in. The box takes an ADDRESS or an `@username`; a username is resolved
 *     to that player's address here (see `admin-identifier.ts` for why it is
 *     resolved rather than stored), and every check below — the env-super-admin
 *     rejection included — then runs on the RESOLVED address, so widening the
 *     input cannot widen who may be granted a role.
 *   - The ROLE being granted is narrowed through `toRole` rather than compared
 *     against a hand-written pair, so a role added to the ladder is offered here
 *     the moment it exists and a value that is not a role bounces to a banner
 *     instead of the CHECK constraint.
 *   - A role that is at its SEAT CAP (`ROLE_SEATS`) refuses the grant. The store
 *     decides that inside the same statement as the write — see `addUser` — so
 *     what these actions do is turn its `ok: false` into a sentence. Nothing is
 *     re-checked here: a second check in JS would be a second source of truth
 *     for the same question, and the one the page could pass while the statement
 *     refuses.
 *
 * Refusals and BREAKAGES stay separate throughout. `ok: false` is a decision
 * this surface made and reads as a sentence about seats; a rejected promise is
 * the database being down and reads as "(database error)". Collapsing them would
 * tell somebody to go free up a seat because Neon was unreachable.
 *
 * Result reporting uses the querystring: `?ok=<message>` / `?error=<message>`
 * are full human-readable sentences (the page renders them verbatim in a banner).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import {
  addUser,
  setRole,
  removeUser,
  isSuperAdminEmail,
  type Role,
  type SeatResult,
} from "@/app/lib/dashboard-users";
import {
  ROLE_LABEL,
  defaultSeats,
  roleFullMessage,
  toRole,
} from "@/app/lib/permissions";
import { parseAdminIdentifier } from "@/app/lib/admin-identifier";
import { getPlayerByUsername, type Player } from "@/app/lib/players";

/** Where every action lands; centralised so the path never drifts. */
const USERS_PATH = "/dashboard/users";

/** Pull the `email` field, normalised to the store's canonical form. */
function readEmail(formData: FormData): string {
  return String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Resolve what the invite box was given to the address the allow-list is keyed
 * by, or bounce back with a banner explaining why it could not be.
 *
 * An `@username` is resolved HERE, once, rather than stored: see
 * `admin-identifier.ts` for why a renameable name is the wrong key. Only players
 * who have signed in and claimed a username can be invited that way — anyone
 * else is invited by address exactly as before, which is also the only way to
 * invite somebody who has never signed in.
 *
 * The store read is wrapped so a down database degrades to a banner rather than
 * a raw 500, matching the write paths below. `back()` redirects (it throws a
 * control signal), so it stays outside the try.
 */
async function resolveInviteEmail(formData: FormData): Promise<string> {
  const target = parseAdminIdentifier(String(formData.get("email") ?? ""));
  if (!target) {
    back("error", "Enter an email address or an @username");
  }
  if (target.kind === "email") return target.email;

  let player: Player | null;
  try {
    player = await getPlayerByUsername(target.username);
  } catch {
    back("error", "Username lookup failed (database error)");
  }
  if (!player) {
    back("error", `No player is using @${target.username}`);
  }
  // Re-normalise rather than trusting the column. `dashboard_users.email` is a
  // LOWERCASE PRIMARY KEY and `getUserRole` lowercases before comparing, so a
  // mixed-case `players.email` — nothing in the schema forbids one, and rows
  // predate the normalising upsert — would otherwise write an admin row that
  // could never match at sign-in: access silently granted to nobody. The typed
  // address is already canonical via `parseAdminIdentifier`; this is the same
  // guarantee for the resolved one.
  return player.email.trim().toLowerCase();
}

/** Redirect back to the users page carrying a banner message. */
function back(kind: "ok" | "error", message: string): never {
  redirect(`${USERS_PATH}?${kind}=${encodeURIComponent(message)}`);
}

/**
 * The sentence a seat refusal renders.
 *
 * Built from what the STORE counted and the limit it counted against, rather
 * than from a fresh read, for the same reason the actions do not re-check the
 * cap: those two numbers are the only ones that were ever true at the moment of
 * the write. A second read could report a different limit — the settings page
 * is one click away — and name a cap that did not refuse anything.
 *
 * `roleFullMessage` takes a `Seats`, so the pair is lifted into one covering
 * just this role. The shared wording lives there and is what the invite form
 * shows too, so a refused grant and the hint above it cannot describe the cap
 * differently.
 */
function seatsFullMessage(
  role: Role,
  refusal: { taken: number; limit: number },
): string {
  const seats = defaultSeats();
  seats.limits[role] = refusal.limit;
  seats.taken[role] = refusal.taken;
  return roleFullMessage(seats, role);
}

/**
 * Invite (or re-assert) a user AT A ROLE. The acting super admin's address is
 * recorded as the inviter. A missing or malformed address bounces back to the
 * form; a valid one is upserted and the list revalidated.
 *
 * The role defaults to `admin` when the field is absent, which keeps a POST from
 * an older form (or a hand-rolled one) behaving exactly as it did before the
 * field existed. It never defaults DOWNWARD to the weakest role: a silent
 * demotion of a colleague somebody meant to invite as an admin is the failure
 * that gets noticed late, when they cannot do their job.
 */
export async function addAdminAction(formData: FormData): Promise<void> {
  const { email: actor } = await requireRole("super_admin");

  const raw = formData.get("role");
  const role = raw == null ? "admin" : toRole(raw);
  if (!role) back("error", "Pick a role");

  const email = await resolveInviteEmail(formData);
  // Env super admins are governed by SUPER_ADMIN_EMAILS, not this table; inviting
  // one as an 'admin' would only write a misleading row (their effective role is
  // still super_admin via the allow-list). Reject it for clarity.
  if (isSuperAdminEmail(email)) {
    back("error", "That address is an env super admin");
  }

  // Only the store write can throw on a down/unconfigured DB; keep it INSIDE the
  // try so a raw 500 becomes a banner. The success back() (a redirect) must stay
  // OUTSIDE — redirect() throws a control signal that this catch would swallow.
  let result: SeatResult;
  try {
    result = await addUser(email, role, actor);
  } catch {
    back("error", "Add admin failed (database error)");
  }
  // A full role is a DECISION, so it is reported as one. The row was not
  // written, so there is nothing to revalidate and the path below is skipped.
  if (!result.ok) back("error", seatsFullMessage(role, result));
  revalidatePath(USERS_PATH);
  back("ok", `Added as ${ROLE_LABEL[role].toLowerCase()}`);
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
  // a raw 500 instead of a graceful banner. Narrowed by `toRole` rather than by
  // a hand-written pair of comparisons, which is what silently kept a new rung
  // ungrantable from this form.
  const role = toRole(formData.get("role"));
  if (!role) back("error", "Invalid role");

  if (isSuperAdminEmail(email)) {
    back("error", "Cannot change an env super admin");
  }

  // See addAdminAction: wrap only the store write so a DB error degrades to a
  // banner, leaving the success redirect outside the try where it belongs.
  let result: SeatResult;
  try {
    result = await setRole(email, role);
  } catch {
    back("error", "Set role failed (database error)");
  }
  if (!result.ok) back("error", seatsFullMessage(role, result));
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
