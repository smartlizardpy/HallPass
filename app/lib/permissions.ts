/**
 * HallPass — what each dashboard role may actually do.
 *
 * Mirrors `tracker/config.ts`: pure, no `server-only`, no database, `import
 * type` only. Read by the server guards, the server components AND the client
 * islands, so the control a page renders cannot drift from the rule the action
 * enforces.
 *
 * ── WHY THIS MODULE EXISTS AT ALL ───────────────────────────────────────────
 * Until `beta_admin` there were two roles and one rule ("is this person a super
 * admin"), written out at each of the handful of places that cared.
 * `requireRole` reflected that: it only ever enforced a LEVEL for
 * `super_admin`, and let every other role through every other guard. With two
 * roles that was correct by accident, because `admin` was the floor. With three
 * it is a hole big enough to make a beta admin a full admin at ~60 call sites,
 * so the ladder is now real (see {@link atLeast}) and the answers live here.
 *
 * ── A RANK, NOT A CAPABILITY SET ────────────────────────────────────────────
 * The three roles are LINEAR by construction (see `Role` in
 * `dashboard-users.ts`), so a single comparison answers every guard and there is
 * no matrix to keep consistent. The one rule that is NOT a rank is
 * {@link canConfirmOwnWork}, and that is exactly why it is a named predicate
 * rather than another `requireRole` call: "may not judge your own work" is a
 * property of the decision, not of the rung.
 */

import type { Role } from "@/app/lib/dashboard-users";

/**
 * Every role, weakest first. The runtime twin of the `Role` union.
 *
 * A union alone cannot be iterated, and the tests here need to assert things
 * about ALL roles ("every role has a label", "every role has a home"). Declaring
 * it `readonly Role[]` means a fourth role added to the union without being
 * added here fails the exhaustiveness check in `permissions.test.ts` rather than
 * quietly falling out of those assertions.
 */
export const ROLES = ["beta_admin", "admin", "super_admin"] as const satisfies
  readonly Role[];

/**
 * The ladder, as numbers.
 *
 * `Record<Role, number>` is doing real work: a new role added to the union
 * without a rank is a compile error here, and an unranked role is precisely the
 * one that would sail through every comparison below.
 */
export const ROLE_RANK: Record<Role, number> = {
  beta_admin: 0,
  admin: 1,
  super_admin: 2,
};

/** Does `role` sit at or above `min` on the ladder? The whole guard, once. */
export function atLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

// ---------------------------------------------------------------------------
// The named rungs
// ---------------------------------------------------------------------------
//
// Constants rather than string literals at the call sites, for the reason
// `TRACKER_DEV_ROLE` gives: a permission has two halves that must agree — the
// guard the action enforces and the condition the page renders the control
// under — and written out separately they drift silently in the dangerous
// direction.

/**
 * The floor for opening the dashboard at all.
 *
 * Every signed-in holder of a role may LOOK. That is the deliberate shape of
 * the beta-admin grant: they can read the games list, the curation screen and
 * the overview so they know what they are assigning, and they can write in
 * exactly one place. Pages guard with this and hide their write controls behind
 * {@link canEditSite}; the ACTIONS are what actually refuse.
 */
export const DASHBOARD_MIN_ROLE: Role = "beta_admin";

/** The floor for working the beta programme. Currently the same rung. */
export const BETA_MIN_ROLE: Role = "beta_admin";

/**
 * The floor for changing anything OUTSIDE the beta programme.
 *
 * Games, the catalogue, curation, leaderboards, moderation, the tracker, tags.
 * Named separately from `"admin"` written inline so that a future re-levelling
 * is one edit rather than a search for a string that also appears in prose.
 */
export const SITE_WRITE_ROLE: Role = "admin";

// ---------------------------------------------------------------------------
// The questions call sites actually ask
// ---------------------------------------------------------------------------

/**
 * May this role change anything outside the beta programme?
 *
 * The single predicate behind every hidden write control on the dashboard. The
 * matching server-side refusal is `requireRole(SITE_WRITE_ROLE)` in the action —
 * hiding a form is UX, the guard is the boundary, and both read from here.
 */
export function canEditSite(role: Role): boolean {
  return atLeast(role, SITE_WRITE_ROLE);
}

/**
 * May this role add or remove beta testers directly?
 *
 * No, for a beta admin — and that asymmetry is the point of the role. Sending a
 * playtest is reversible and costs nothing; putting somebody INTO the programme
 * grants them a surface that pays XP, so it is the one beta action that needs a
 * second person. A beta admin raises a request instead
 * ({@link mustRequestTesters}), which an admin approves.
 */
export function canManageTesters(role: Role): boolean {
  return atLeast(role, SITE_WRITE_ROLE);
}

/**
 * Must this role ask before a tester joins? The exact complement of
 * {@link canManageTesters}, named so the invite UI reads as an intention rather
 * than as a negation.
 */
export function mustRequestTesters(role: Role): boolean {
  return !canManageTesters(role);
}

/**
 * May this role judge a report or an image THEY THEMSELVES submitted?
 *
 * Four eyes. An admin can file beta reports like anyone else (admins pass the
 * tester guard without a membership row — see `beta/index.ts`), and triage is
 * what pays XP, so "accept my own report" is a self-service payout. It also
 * quietly corrupts the queue's meaning: the record of a decision is worth
 * nothing if the decider and the reporter are the same person.
 *
 * NOT A RUNG, and deliberately not expressed as one. It binds a full `admin`
 * exactly as it binds a `beta_admin` — the rule is about the decision, not about
 * how much the person is trusted. Only `super_admin` is exempt, and only because
 * somebody has to be able to unstick a one-person site: without an exemption a
 * solo operator's own reports would be unjudgeable forever.
 */
export function canConfirmOwnWork(role: Role): boolean {
  return role === "super_admin";
}

// ---------------------------------------------------------------------------
// Narrow-from-unknown
// ---------------------------------------------------------------------------

/**
 * Narrow a form field to a `Role`, or `null`.
 *
 * Takes `unknown` for the reason `beta/config.ts` gives: the value arrives from
 * FormData, which is user input at the boundary. Casting instead would let a
 * malformed role reach the `dashboard_users_role_check` CHECK and turn somebody
 * mistyping into a raw 500 — and, worse on this particular surface, would make
 * the set of grantable roles a property of whatever HTML happens to be posted.
 */
export function toRole(value: unknown): Role | null {
  // `typeof value === "string"` FIRST, exactly as `beta/config.ts`'s `memberOf`
  // does it. Narrowing on `String(value)` instead accepts anything that merely
  // stringifies to a role name and then hands the original object on as a
  // `Role` — a value that is not a string at all, typed as though it were.
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
    ? (value as Role)
    : null;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/**
 * How a role is named on screen. `Record<Role, string>` so a new role cannot
 * ship without a label and fall back to printing its raw column value.
 *
 * Lived in three places before this (the dashboard shell, the users table, the
 * account menu), which is how "Beta admin" would otherwise have shown up as
 * "Admin" in the arcade header while the dashboard called it something else.
 */
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  beta_admin: "Beta admin",
};

/**
 * One line explaining what the role grants, shown where a role is CHOSEN.
 *
 * Load-bearing rather than decorative, on the same argument as the tracker's
 * lane hints: a three-way choice only exists if the person making it can see
 * what the middle option costs.
 */
export const ROLE_HINT: Record<Role, string> = {
  super_admin: "Everything, including managing dashboard users",
  admin: "Everything except managing dashboard users",
  beta_admin: "Beta programme only — read-only everywhere else",
};

/**
 * Where a role lands when it is turned away from a page above its rung.
 *
 * MUST be a page that role can actually open, or `requireRole` bounces them
 * into a redirect loop; `permissions.test.ts` pins that each destination is at
 * or below its own role's reach. A beta admin goes to the one surface they can
 * work rather than to an overview they can only read.
 */
export const DASHBOARD_HOME: Record<Role, string> = {
  super_admin: "/dashboard",
  admin: "/dashboard",
  beta_admin: "/dashboard/beta",
};

// ---------------------------------------------------------------------------
// Seats — how MANY people may hold a rung at once
// ---------------------------------------------------------------------------
//
// Everything above answers "what may this rung do". This section answers a
// different question about the same ladder: how many of them there may be. It
// lives here for the reason `ROLE_LABEL` does — the invite form, the per-row
// modal and the two store writes all have to agree on the number, and written
// out at each of them they drift in the direction that grants more.
//
// See `role-seats-design.md` for the reasoning; the two rules worth repeating
// at the call sites are:
//
//   * The env allow-list (`SUPER_ADMIN_EMAILS`) is EXEMPT from the check and
//     still CONSUMES a seat. Capping the sign-in path could lock the last super
//     admin out of a full table with no way back in, which is worse than one
//     seat too many; counting their row is what stops the UI granting a second
//     super admin beside them.
//   * Over capacity is therefore reachable (an env address signing in for the
//     first time, or several of them listed). It is a state to REPORT — see
//     {@link isOverSeats} — never one to create.

/**
 * How many people may hold each role at once.
 *
 * `Record<Role, number>` so a role added to the ladder without a seat count is a
 * compile error rather than an uncapped rung — which is precisely the one that
 * would then grow without anybody noticing.
 *
 * Five holders in total, and deliberately tight rather than generous: a limit
 * set above actual use enforces nothing and is discovered to be wrong only when
 * it finally bites.
 */
export const ROLE_SEATS: Record<Role, number> = {
  super_admin: 1,
  admin: 1,
  beta_admin: 3,
};

/**
 * How many rows currently hold each role.
 *
 * A full `Record` rather than a sparse map, so "nobody holds this role" is `0`
 * and never `undefined` — the value that makes `taken < limit` read `NaN < 1`
 * and quietly refuse every grant.
 */
export type SeatCounts = Record<Role, number>;

/** A zeroed {@link SeatCounts}, for the "database unreachable" render. */
export function emptySeatCounts(): SeatCounts {
  return { beta_admin: 0, admin: 0, super_admin: 0 };
}

/**
 * Seats still free on `role`. Never negative: over capacity is a real state
 * (see the section note), and a negative "free" count would read as free seats
 * to any caller doing arithmetic on it.
 */
export function seatsLeft(taken: SeatCounts, role: Role): number {
  return Math.max(0, ROLE_SEATS[role] - taken[role]);
}

/** Is `role` full — i.e. would granting it now take it past its cap? */
export function isRoleFull(taken: SeatCounts, role: Role): boolean {
  return taken[role] >= ROLE_SEATS[role];
}

/**
 * Is `role` held by MORE people than it has seats?
 *
 * Distinct from {@link isRoleFull} on purpose: full is the ordinary end state
 * and needs no comment, over-capacity is the one the Users page calls out. The
 * only ways in are the env exemption and a role's seats being lowered under
 * people who already hold it, so it is rare, benign, and worth saying out loud
 * rather than leaving somebody to wonder why a grant will not go through.
 */
export function isOverSeats(taken: SeatCounts, role: Role): boolean {
  return taken[role] > ROLE_SEATS[role];
}

/**
 * The weakest role with a seat going spare, or `null` when every role is full.
 *
 * Weakest-first (`ROLES` order) because this picks the default for a form: the
 * fallback for "the role we wanted to preselect is full" must not be a stronger
 * rung than the one asked for.
 */
export function firstFreeRole(taken: SeatCounts): Role | null {
  return ROLES.find((role) => !isRoleFull(taken, role)) ?? null;
}

/** `"2 of 3 seats used"` — the count as shown beside a role's hint. */
export function seatSummary(taken: SeatCounts, role: Role): string {
  const seats = ROLE_SEATS[role];
  return `${taken[role]} of ${seats} ${seats === 1 ? "seat" : "seats"} used`;
}

/**
 * The banner a refused grant renders, as a full sentence.
 *
 * It names the count rather than only saying "full", because the person reading
 * it is about to decide whether somebody else should lose the seat, and
 * "1 of 1" tells them what they are choosing between. Written here rather than
 * at the action so the refusal reads the same wherever it is raised.
 */
export function roleFullMessage(taken: SeatCounts, role: Role): string {
  const seats = ROLE_SEATS[role];
  const held = taken[role];
  const label = ROLE_LABEL[role].toLowerCase();
  return (
    `No ${label} seats left (${held} of ${seats} used). ` +
    `Remove or re-role an existing ${label} first.`
  );
}
