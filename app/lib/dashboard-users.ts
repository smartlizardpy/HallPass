/**
 * HallPass dashboard — user/role store over Neon.
 *
 * The dashboard's authorization model is OURS, not the identity provider's:
 * Google (Auth.js v5) only proves *who* a person is; this module is the
 * allow-list that decides *whether* they may enter and at *what* level. Two
 * roles exist — 'super_admin' (everything, incl. managing these very rows) and
 * 'admin' (boards, games, scores, analytics). See `app/lib/auth.sql` for the
 * `dashboard_users` table this layer reads and writes.
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

/** The two dashboard authorization levels. */
export type Role = "super_admin" | "admin";

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

/** Narrow a free-form driver value to a `Role`, defaulting to the lower role. */
function toRole(value: unknown): Role {
  return value === "super_admin" ? "super_admin" : "admin";
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
  return role === "super_admin" || role === "admin" ? role : null;
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

/**
 * Invite (or re-assert) an `admin`. `invitedBy` records who extended the
 * invite; on a pre-existing row we force the role back to `'admin'` and refresh
 * the inviter, which doubles as the "re-add a removed-then-returning" path.
 */
export async function addAdmin(email: string, invitedBy: string): Promise<void> {
  const target = normalizeEmail(email);
  await sql`
    INSERT INTO dashboard_users (email, role, invited_by)
    VALUES (${target}, 'admin', ${invitedBy})
    ON CONFLICT (email) DO UPDATE SET
      role = 'admin',
      invited_by = EXCLUDED.invited_by
  `;
}

/** Set an existing user's role outright (no-op if the email has no row). */
export async function setRole(email: string, role: Role): Promise<void> {
  const target = normalizeEmail(email);
  await sql`
    UPDATE dashboard_users SET role = ${role} WHERE email = ${target}
  `;
}

/** Revoke a user entirely by deleting their row. */
export async function removeUser(email: string): Promise<void> {
  const target = normalizeEmail(email);
  await sql`DELETE FROM dashboard_users WHERE email = ${target}`;
}
