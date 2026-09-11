/**
 * HallPass dashboard — user/role store over Neon.
 *
 * The dashboard's authorization model is OURS, not the identity provider's:
 * Google (Auth.js v5) only proves *who* a person is; this module is the
 * allow-list that decides *whether* they may enter and at *what* level. Three
 * roles exist, lowest first — 'beta_admin' (the beta programme only, read-only
 * elsewhere), 'admin' (boards, games, scores, analytics) and 'super_admin'
 * (everything, incl. managing these very rows). See `app/lib/auth.sql` for the
 * `dashboard_users` table this layer reads and writes, and
 * `app/lib/permissions.ts` for what each rung may actually do — this module
 * stores the role, it does not interpret it.
 *
 * How MANY may hold a rung at once is capped too (`ROLE_SEATS`, also in
 * `permissions.ts`). The counting has to happen inside the same statement as the
 * write, so it lives here even though the numbers do not — see the Seats section
 * at the foot of this file, and `role-seats-design.md` for the reasoning.
 *
 * Unlike the scoreboard store, there is no `createStore(sql)` factory here: this
 * module talks to the shared, server-only `sql` from `@/app/lib/db` directly.
 *
 * SQL safety — the load-bearing rule, carried over from the scoreboard store:
 *   The `neon()` tagged template parameterises interpolated VALUES; it does NOT
 *   reliably splice raw SQL fragments. So we NEVER interpolate a fragment
 *   variable. Where behaviour depends on a whitelisted enum (e.g. the
 *   super-admin path of `upsertUserOnLogin`), we branch in JS into explicit,
 *   fully-written query templates and only ever interpolate BOUND values.
 *
 * Email normalisation: every email — whether arriving from a session, a form,
 * or the env allow-list — is funnelled through `.trim().toLowerCase()` before
 * it is stored or compared, so the PRIMARY KEY and all lookups stay canonical.
 *
 * Timestamp note: Postgres `timestamptz` columns come back from the HTTP driver
 * as strings; numeric/timestamp egress is funnelled through `String(...)` (via
 * {@link toIso}) so the surface of this module is plain JSON-safe strings.
 */

import { sql } from "@/app/lib/db";
// The seat caps live with the ladder, not here: this module stores a role, it
// does not decide policy about one. The import is one-way — `permissions.ts`
// takes only `import type { Role }` back, so there is no runtime cycle.
import {
  ROLE_SEATS,
  emptySeatCounts,
  type SeatCounts,
} from "@/app/lib/permissions";

/**
 * The three dashboard authorization levels.
 *
 * Deliberately LINEAR: everything a `beta_admin` may do an `admin` may do, and
 * everything an `admin` may do a `super_admin` may do. `permissions.ts` ranks
 * them on exactly that assumption, so a fourth value that is a SIDEWAYS grant
 * (rather than a rung) does not belong here — it would need a capability set,
 * not a rank.
 */
export type Role = "super_admin" | "admin" | "beta_admin";

/** A dashboard user as exposed to the rest of the app (JSON-safe strings). */
export interface DashboardUser {
  email: string;
  role: Role;
  name: string | null;
  image: string | null;
  invitedBy: string | null;
  createdAt: string;
  lastLogin: string | null;
}

/** A row as returned by the driver (column names as keys). */
type Row = Record<string, unknown>;

/** Canonical email form used for every store/compare. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Coerce a driver timestamp to an ISO-ish string (falls back to `String`). */
function toIso(value: unknown): string {
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/**
 * Narrow a free-form driver value to a `Role`, defaulting to the LEAST
 * privileged one.
 *
 * The default is the safety property, not a formality: an unrecognised column
 * value means this deployment does not understand the row, and the only reading
 * of it that cannot accidentally grant something is the bottom rung. It used to
 * default to 'admin', which was harmless while 'admin' WAS the bottom rung and
 * stopped being so the moment 'beta_admin' existed below it.
 */
function toRole(value: unknown): Role {
  if (value === "super_admin") return "super_admin";
  if (value === "admin") return "admin";
  return "beta_admin";
}

function mapUser(row: Row): DashboardUser {
  return {
    email: String(row.email),
    role: toRole(row.role),
    name: row.name == null ? null : String(row.name),
    image: row.image == null ? null : String(row.image),
    invitedBy: row.invited_by == null ? null : String(row.invited_by),
    createdAt: toIso(row.created_at),
    lastLogin: row.last_login == null ? null : toIso(row.last_login),
  };
}

/**
 * Is `email` on the env-driven super-admin allow-list? `SUPER_ADMIN_EMAILS` is
 * comma- and/or whitespace-separated; matching is trimmed and case-insensitive.
 *
 * The env var is read INSIDE the function (not captured at module load) so that
 * rotating the allow-list takes effect without re-evaluating this module — and
 * so tests can set it per-case.
 */
export function isSuperAdminEmail(email: string): boolean {
  const target = normalizeEmail(email);
  if (!target) return false;
  const allow = (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(target);
}

/**
 * Effective role for `email`. The env allow-list wins unconditionally — a
 * listed address is `super_admin` even if it has no row yet — otherwise we read
 * the stored role. Returns `null` for an unknown, non-allow-listed user (i.e.
 * "denied"; the caller turns that into a rejected sign-in).
 */
export async function getUserRole(email: string): Promise<Role | null> {
  const target = normalizeEmail(email);
  if (isSuperAdminEmail(target)) return "super_admin";
  const rows = await sql`
    SELECT role FROM dashboard_users WHERE email = ${target}
  `;
  if (rows.length === 0) return null;
  const role = rows[0].role;
  // Narrowed EXPLICITLY rather than through `toRole`, because the two answer
  // different questions. `toRole` maps a row for display and must always produce
  // a role; this decides whether somebody may enter at all, so an unrecognised
  // value has to mean "denied" — mapping it to the bottom rung would let a typo
  // in the column grant beta-programme access.
  return role === "super_admin" || role === "admin" || role === "beta_admin"
    ? role
    : null;
}

/**
 * Effective role for a SESSION, or `null` when it cannot be established.
 * NEVER THROWS — and that is the whole reason this exists beside
 * {@link getUserRole}.
 *
 * `getUserRole` is a plain store read and rejects when Neon is unreachable. That
 * rejection used to travel out of the Auth.js `jwt` callback, which Auth.js
 * catches as a `JWTSessionError` and answers by resolving the session to `null`.
 * The blast radius was therefore the entire SESSION rather than the role: one
 * database blip signed EVERY player out of the arcade — their leaderboard
 * identity, friends and challenges — even though `playerId` is pinned on the
 * token at login and needs no database at all to be read back.
 *
 * So the two halves are separated here. Authorization fails CLOSED: no role,
 * `requireRole` bounces to sign-in, and access returns by itself on the first
 * request that reaches the database again. Identity is left alone.
 *
 * Deliberately NOT the third option — keeping the role the token already had.
 * That would hand anyone who can make the database fail a way to hold a revoked
 * role indefinitely, and per-request re-resolution (see the `jwt` callback in
 * `auth.ts`) exists precisely so that revoking a user lands on their next
 * request. A failed lookup is not evidence of authorization.
 *
 * Note the env allow-list still wins without touching Neon, so a
 * `SUPER_ADMIN_EMAILS` address keeps dashboard access straight through an
 * outage — which is when somebody needs to get in and look.
 *
 * The address is kept OUT of the log line: a role lookup failing is systemic
 * (the database is down), not something about one person, and this runs on every
 * request of every signed-in visitor.
 */
export async function getSessionRole(email: string): Promise<Role | null> {
  try {
    return await getUserRole(email);
  } catch (error) {
    console.error(
      "[auth] dashboard role lookup failed; continuing without a role:",
      error,
    );
    return null;
  }
}

/**
 * Provision/refresh a user's row on sign-in.
 *
 * The invariant is "a login may refresh your profile and stamp your last login,
 * but it must never DOWNGRADE your role". Hence `ON CONFLICT` updates only
 * `name`/`image`/`last_login` and leaves `role` untouched for an existing row.
 *
 * Super-admin allow-list emails are the one exception, handled by an explicit
 * branch (not a spliced fragment): they are inserted at — and on every login
 * re-asserted to — `'super_admin'`, so an env promotion is honoured even if the
 * row was previously a plain `admin`.
 *
 * NEITHER BRANCH CONSULTS A SEAT, and that is deliberate for the env one. A cap
 * on the sign-in path could lock the last super admin out of a full table with
 * no way back in — worse than one seat too many — so the allow-list is the
 * break-glass path and stays uncapped. The row it writes is still COUNTED, which
 * is what stops `addUser`/`setRole` granting a second super admin beside them.
 * The non-env branch writes the role the CALLER already resolved for an existing
 * or invited user, so it grants nothing new to check.
 */
export async function upsertUserOnLogin(u: {
  email: string;
  name?: string | null;
  image?: string | null;
  role: Role;
}): Promise<void> {
  const email = normalizeEmail(u.email);
  const name = u.name ?? null;
  const image = u.image ?? null;

  if (isSuperAdminEmail(email)) {
    await sql`
      INSERT INTO dashboard_users (email, role, name, image, last_login)
      VALUES (${email}, 'super_admin', ${name}, ${image}, now())
      ON CONFLICT (email) DO UPDATE SET
        role = 'super_admin',
        name = EXCLUDED.name,
        image = EXCLUDED.image,
        last_login = now()
    `;
    return;
  }

  await sql`
    INSERT INTO dashboard_users (email, role, name, image, last_login)
    VALUES (${email}, ${u.role}, ${name}, ${image}, now())
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      image = EXCLUDED.image,
      last_login = now()
  `;
}

/** All dashboard users, oldest first (stable for an admin-management table). */
export async function listUsers(): Promise<DashboardUser[]> {
  const rows = await sql`
    SELECT email, role, name, image, invited_by, created_at, last_login
    FROM dashboard_users
    ORDER BY created_at ASC
  `;
  return rows.map(mapUser);
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------
//
// How many people may hold a role at once is policy, and it lives in
// `permissions.ts` (see `ROLE_SEATS` and `role-seats-design.md`). What lives
// HERE is the counting and the refusal, because both have to happen inside the
// same statement as the write.
//
// THE ENV ALLOW-LIST IS NOT CHECKED AND STILL COUNTS. `upsertUserOnLogin`'s
// super-admin branch above deliberately does not consult a seat: a cap on the
// sign-in path could lock the last super admin out of a full table with no way
// back in, which is a worse failure than one seat too many. Their ROW is counted
// like any other, which is what stops this layer granting a second super admin
// beside them. So over capacity is reachable — the Users page reports it rather
// than pretending it cannot happen.

/**
 * The outcome of a write that had to fit in a seat.
 *
 * A discriminated result rather than a thrown error, because "that role is
 * full" is an ordinary answer the screen renders as a banner, not an
 * exceptional one. A genuine database failure still REJECTS, so the two stay
 * distinguishable at the call site: the caller's `catch` means "the database
 * broke", `ok: false` means "we decided not to".
 *
 * `taken` rides along so the banner can say `1 of 1` rather than only "full" —
 * the person reading it is deciding who loses a seat.
 */
export type SeatResult =
  | { ok: true }
  | { ok: false; taken: number; limit: number };

/**
 * How many rows currently hold each role.
 *
 * Roles the CHECK constraint would not accept are not counted. Such a value
 * grants nothing (`getUserRole` denies it, deliberately — see the note there),
 * so counting it would hold a seat against a row that can do nothing with it.
 *
 * Returns a FULL record — `emptySeatCounts()` seeds every rung at zero, so a
 * role nobody holds reads `0` and never `undefined`, which is the value that
 * would make every `taken < limit` comparison `NaN < 1` and refuse every grant.
 */
export async function countRoleSeats(): Promise<SeatCounts> {
  const rows = await sql`
    SELECT role, count(*)::int AS held
    FROM dashboard_users
    GROUP BY role
  `;
  const counts = emptySeatCounts();
  for (const row of rows) {
    const role = String(row.role);
    if (role in counts) counts[role as Role] += Number(row.held);
  }
  return counts;
}

/**
 * Invite (or re-assert) a user AT A ROLE, if that role has a seat free.
 * `invitedBy` records who extended the invite; on a pre-existing row we force
 * the role back to the invited one and refresh the inviter, which doubles as the
 * "re-add a removed-then-returning" path.
 *
 * `role` is a BOUND value, not a spliced fragment, so the module's SQL-safety
 * rule holds without branching into three query templates. It is still narrowed
 * by the caller before it gets here (`users/actions.ts`), because an unchecked
 * form value would otherwise reach the CHECK constraint and turn a typo into a
 * raw 500.
 *
 * ── ONE STATEMENT, NOT CHECK-THEN-WRITE ─────────────────────────────────────
 * The count and the insert are a single statement so there is no round trip
 * between them in which the last seat can be taken by somebody else's click.
 * The data-modifying CTE runs exactly once whether or not the outer SELECT
 * reads from it, and its `WHERE` is what actually refuses.
 *
 * Honest about the limit: under READ COMMITTED two concurrent grants can still
 * each see the same free seat. The window is one statement wide on a screen used
 * by a handful of people, and the worst it produces is a role one over its cap —
 * which the Users page surfaces and the next removal clears. A schema-level
 * guarantee would have to fire on the sign-in path too, where the env exemption
 * above says it must not.
 *
 * The invitee is EXCLUDED from the count (`email <> target`). Otherwise
 * re-asserting the single admin at the role they already hold would fail against
 * the seat they themselves occupy, and moving somebody between roles would be
 * blocked by a seat their move is about to free.
 */
export async function addUser(
  email: string,
  role: Role,
  invitedBy: string,
): Promise<SeatResult> {
  const target = normalizeEmail(email);
  const rows = await sql`
    WITH seat AS (
      SELECT count(*)::int AS taken
      FROM dashboard_users
      WHERE role = ${role} AND email <> ${target}
    ),
    granted AS (
      INSERT INTO dashboard_users (email, role, invited_by)
      SELECT ${target}, ${role}, ${invitedBy}
      FROM seat
      WHERE seat.taken < ${ROLE_SEATS[role]}
      ON CONFLICT (email) DO UPDATE SET
        role = EXCLUDED.role,
        invited_by = EXCLUDED.invited_by
      RETURNING email
    )
    SELECT
      (SELECT taken FROM seat) AS taken,
      EXISTS (SELECT 1 FROM granted) AS granted
  `;
  return seatResult(rows[0], role);
}

/**
 * Set an existing user's role outright, if that role has a seat free. A no-op
 * (reported as success) when the email has no row — the screen only offers this
 * for rows it has just listed, so a missing one is a stale page rather than
 * something to explain.
 *
 * Same one-statement shape, same self-exclusion and the same honest limit as
 * {@link addUser}; see there for why each is the way it is.
 */
export async function setRole(email: string, role: Role): Promise<SeatResult> {
  const target = normalizeEmail(email);
  const rows = await sql`
    WITH seat AS (
      SELECT count(*)::int AS taken
      FROM dashboard_users
      WHERE role = ${role} AND email <> ${target}
    ),
    granted AS (
      UPDATE dashboard_users
      SET role = ${role}
      WHERE email = ${target}
        AND (SELECT taken FROM seat) < ${ROLE_SEATS[role]}
      RETURNING email
    )
    SELECT
      (SELECT taken FROM seat) AS taken,
      EXISTS (SELECT 1 FROM granted) AS granted
  `;
  return seatResult(rows[0], role);
}

/**
 * Read the `{ taken, granted }` row both writes above return into a
 * {@link SeatResult}.
 *
 * `granted = false` is ambiguous on its own — it means either "no seat" or, for
 * `setRole`, "no such row" — so the COUNT decides which: a write that did not
 * happen while seats were free did not happen for some other reason, and that
 * reason is not the cap's to report. Reading it the other way round would turn
 * every stale-row no-op into a "role is full" banner that names a role with
 * seats going spare.
 */
function seatResult(row: Row | undefined, role: Role): SeatResult {
  const limit = ROLE_SEATS[role];
  const taken = Number(row?.taken ?? 0);
  if (row?.granted === true) return { ok: true };
  return taken < limit ? { ok: true } : { ok: false, taken, limit };
}

/** Revoke a user entirely by deleting their row. */
export async function removeUser(email: string): Promise<void> {
  const target = normalizeEmail(email);
  await sql`DELETE FROM dashboard_users WHERE email = ${target}`;
}
