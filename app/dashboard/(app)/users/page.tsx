/**
 * HallPass dashboard — user/role management (super-admin only).
 *
 * The super-admin-exclusive surface for the dashboard's OWN authorization model:
 * Google proves identity, but only emails listed here (or pinned via the
 * `SUPER_ADMIN_EMAILS` env allow-list) may sign in, and this table is where they
 * are invited, re-roled, and revoked. The route guard fails closed —
 * `requireRole("super_admin")` redirects a plain admin to `/dashboard` — and the
 * shell already hides the nav link for non-super-admins, so this is defence in
 * depth rather than the only gate.
 *
 * Env super admins are shown but locked: they carry a "super admin (env)" chip
 * and expose NO row actions, because their role is re-asserted on every login
 * and a delete would be undone on their next sign-in (see `actions.ts`). The
 * matching write actions reject any attempt to mutate them server-side too.
 *
 * The user store throws when `DATABASE_URL` is unset (the Neon connection is
 * lazy), so the read is wrapped: an unconfigured database renders a friendly
 * notice instead of a 500.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import {
  listUsers,
  isSuperAdminEmail,
  type DashboardUser,
} from "@/app/lib/dashboard-users";
import { addAdminAction } from "./actions";
import { DashHeader } from "../_ui/DashHeader";
import { UserRowActions } from "./UserRowActions";

export const metadata: Metadata = {
  title: "Users",
  description: "Manage HALLPASS dashboard admins and their roles.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{
  ok?: string | string[];
  error?: string | string[];
}>;

/** Collapse a possibly-repeated querystring value to a single string. */
function asString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

/** Human-friendly, locale-stable date for the "added" column. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * Date + time for the "last sign-in" column. `last_login` is stamped on every
 * dashboard login (see `upsertUserOnLogin`), so this answers "did this account
 * ever sign in, and when?". A `null` (invited but never signed in) is the
 * caller's concern — it renders the muted "Never" state instead.
 */
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole("super_admin");

  const params = await searchParams;
  const ok = asString(params.ok);
  const error = asString(params.error);

  let users: DashboardUser[] | null = null;
  let dbError = false;
  try {
    users = await listUsers();
  } catch {
    dbError = true;
  }

  return (
    <>
      <DashHeader
        title="Users"
        subtitle="Manage who can sign in to the dashboard and at what level."
        action={
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-brand hover:text-brand-600"
          >
            ← Back to overview
          </Link>
        }
      />

      {ok && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {ok}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <section className="mb-8 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-black tracking-tight">Invite admin</h2>
        <p className="mt-1 text-sm text-muted">
          Invited users sign in with Google. Only listed (or env allow-listed)
          emails may access the dashboard — everyone else is rejected at sign-in.
        </p>
        <form
          action={addAdminAction}
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <label className="block flex-1 text-sm font-semibold text-foreground">
            Email
            <input
              name="email"
              type="email"
              required
              autoComplete="off"
              placeholder="teammate@example.com"
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>
          <button
            type="submit"
            className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Add admin
          </button>
        </form>
      </section>

      {dbError ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Database not configured. Set{" "}
          <code className="font-mono">DATABASE_URL</code> to manage users.
        </div>
      ) : users && users.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-sm font-semibold text-foreground">No users yet.</p>
          <p className="mt-1 text-sm text-muted">
            Invite an admin above, or sign in with an env allow-listed address.
          </p>
        </div>
      ) : (
        users && (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="whitespace-nowrap px-4 py-3">Invited by</th>
                  <th className="px-4 py-3">Added</th>
                  <th className="whitespace-nowrap px-4 py-3">Last sign-in</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const locked = isSuperAdminEmail(user.email);
                  return (
                    <tr
                      key={user.email}
                      className="border-b border-border last:border-0 align-middle hover:bg-surface-2"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        {user.email}
                      </td>
                      <td className="px-4 py-3">
                        {locked ? (
                          <span className="inline-block rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand">
                            super admin (env)
                          </span>
                        ) : (
                          <span className="text-foreground">
                            {ROLE_LABEL[user.role] ?? user.role}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {user.invitedBy ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted tabular-nums">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {user.lastLogin ? (
                          <span className="text-foreground">
                            {formatDateTime(user.lastLogin)}
                          </span>
                        ) : (
                          <span className="text-muted">Never</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {locked ? (
                          <span className="block text-right text-xs text-muted">
                            Locked
                          </span>
                        ) : (
                          <UserRowActions email={user.email} role={user.role} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}
