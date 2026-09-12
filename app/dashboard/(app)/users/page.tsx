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
 * SEATS. Each role is capped (`ROLE_SEATS` — one super admin, one admin, three
 * beta admins), so this screen has to show the count as well as the roles: a
 * select that silently refuses on submit is worse than one that says which
 * option is unavailable and why. The disabling here is UX only — `addUser` and
 * `setRole` refuse inside the statement that writes, so a hand-rolled POST gains
 * nothing from the option being absent.
 *
 * Over capacity gets its own notice rather than being folded into "full",
 * because the only ways in are outside this screen's control — an env
 * allow-listed address signing in for the first time, or several of them listed
 * — and somebody looking at two super admins under a cap of one deserves to be
 * told why rather than left to wonder whether the cap works.
 *
 * CONNECTIONS. Each row's dialog also reports what that account has connected
 * over MCP, because "remove from dashboard" and "revoke their connections" are
 * two different acts and only the first one happens here. Removal does stop the
 * connections working — `mcp/actor.ts` re-resolves the role on every request
 * and answers 403 once there is none — but the grants themselves survive it
 * (`mcp_oauth_tokens.email` is a plain column, not a key into this table), so
 * re-inviting the person hands them back. Somebody about to remove an account
 * deserves to see that there are three of them, and where they are ended.
 *
 * The user store throws when `DATABASE_URL` is unset (the Neon connection is
 * lazy), so the read is wrapped: an unconfigured database renders a friendly
 * notice instead of a 500. The seat count rides in that same try — a screen that
 * claimed every seat was free because the count failed would invite grants the
 * store then refuses.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import {
  countRoleSeats,
  listUsers,
  isSuperAdminEmail,
  type DashboardUser,
} from "@/app/lib/dashboard-users";
import {
  ROLES,
  ROLE_HINT,
  ROLE_LABEL,
  defaultSeats,
  firstFreeRole,
  isOverSeats,
  isRoleFull,
  seatsLeft,
  seatSummary,
  totalSeats,
  type Seats,
} from "@/app/lib/permissions";
import { readSeatLimits } from "@/app/lib/role-seats";
import { listGrants, listManualClients } from "@/app/lib/mcp/oauth/store";
import { connectorsFor, summarizeConnectors } from "@/app/lib/mcp/oauth/connectors";
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

export default async function UsersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole("super_admin");

  const params = await searchParams;
  const ok = asString(params.ok);
  const error = asString(params.error);

  // The limits never throw (an unreadable setting falls back to its default —
  // see `role-seats.ts`), so they are read outside the try that guards the
  // table. The page can always state what the caps ARE, even when it cannot say
  // who is holding them.
  const limits = await readSeatLimits();

  /**
   * What each account has connected, for the row dialogs.
   *
   * Started BEFORE the user read below rather than inside it, for two reasons.
   * It overlaps that round trip instead of queueing behind it — this page is
   * already two queries deep — and its failure is independent: connections are
   * a detail inside a dialog, while the table is the screen. A connections read
   * that took the user list down with it would trade the whole page for a line
   * of it.
   *
   * `.catch` is attached HERE, at construction, not awaited inside a try later:
   * a rejection arriving while the user list is still in flight would be an
   * unhandled rejection before anything was waiting for it. `null` means the
   * question could not be asked, and the dialog says so rather than showing a
   * zero it did not verify.
   */
  const connectorRead = Promise.all([listGrants(null), listManualClients()]).catch(
    () => null,
  );

  let users: DashboardUser[] | null = null;
  let seats: Seats = { ...defaultSeats(), limits };
  let dbError = false;
  try {
    // Both reads, one try. The count is what the form below disables against, so
    // a screen rendered with users but without it would offer every role as free
    // and hand the refusal to the store instead.
    const [listed, taken] = await Promise.all([listUsers(), countRoleSeats()]);
    users = listed;
    seats = { limits, taken };
  } catch {
    dbError = true;
  }

  const connectorRows = await connectorRead;
  const connectors = connectorRows
    ? summarizeConnectors(connectorRows[0], connectorRows[1])
    : null;

  // The role the invite select opens on. `admin` is the historical default and
  // stays the default while it has a seat; when it does not, fall back to the
  // WEAKEST role that does rather than the next one up the ladder — a fallback
  // that climbs would answer "admin is full" by preselecting super admin.
  const defaultRole = isRoleFull(seats, "admin")
    ? firstFreeRole(seats)
    : "admin";
  const overCapacity = ROLES.filter((role) => isOverSeats(seats, role));

  return (
    <>
      <DashHeader
        title="Users"
        subtitle="Manage who can sign in to the dashboard and at what level."
        action={
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard/users/settings"
              className="text-sm font-semibold text-brand hover:text-brand-600"
            >
              Settings
            </Link>
            <Link
              href="/dashboard"
              className="text-sm font-semibold text-brand hover:text-brand-600"
            >
              ← Back to overview
            </Link>
          </div>
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

      {/* THE LIMITS, STATED. A cap is only a cap if the people it binds can see
          it: refusing a grant with a banner that is the first mention of a seat
          limit reads as a bug, and the person's next move is to try again. One
          card per role, each carrying its own number, so "why can I not add
          another admin" is answered before it is asked rather than after. */}
      <section className="mb-8 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-black tracking-tight">Seat limits</h2>
          <Link
            href="/dashboard/users/settings"
            className="text-sm font-semibold text-brand hover:text-brand-600"
          >
            Edit limits →
          </Link>
        </div>
        <p className="mt-1 text-sm text-muted">
          At most {totalSeats(seats.limits)} people may hold a dashboard role at
          once. A grant that would pass a role&rsquo;s cap is refused — remove or
          re-role somebody first, or raise the limit.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          {ROLES.map((role) => {
            const full = isRoleFull(seats, role);
            const over = isOverSeats(seats, role);
            return (
              <div
                key={role}
                className={`rounded-lg border px-4 py-3 ${
                  over
                    ? "border-amber-300 bg-amber-50"
                    : full
                      ? "border-border bg-surface-2"
                      : "border-border bg-surface"
                }`}
              >
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {ROLE_LABEL[role]}
                </dt>
                <dd className="mt-1 text-2xl font-black tabular-nums text-foreground">
                  {/* Usage over the cap, not a bare count: the number that
                      matters to the reader is the gap between them. */}
                  {seats.taken[role]}
                  <span className="text-muted">/{seats.limits[role]}</span>
                </dd>
                <dd className="mt-0.5 text-xs text-muted">
                  {over
                    ? "over the limit"
                    : full
                      ? "full"
                      : `${seatsLeft(seats, role)} free`}
                </dd>
              </div>
            );
          })}
        </dl>
        {dbError && (
          <p className="mt-3 text-xs text-muted">
            Usage is unavailable while the database is unreachable; the limits
            above are the ones in force.
          </p>
        )}
      </section>

      {overCapacity.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-bold">More holders than seats.</p>
          <ul className="mt-1 space-y-0.5">
            {overCapacity.map((role) => (
              <li key={role}>
                {ROLE_LABEL[role]}: {seatSummary(seats, role)}.
              </li>
            ))}
          </ul>
          {/* Naming the cause matters more than naming the numbers. Somebody
              looking at two super admins under a cap of one needs to know where
              it came from and what happens next, not merely that something is
              off. Both causes are named because both are ordinary: a limit was
              lowered under the people holding it, or the env allow-list granted
              a role without ever asking about a seat. */}
          <p className="mt-2">
            This happens when a limit is lowered below the people already holding
            the role, or when an address in{" "}
            <code className="font-mono">SUPER_ADMIN_EMAILS</code> signs in —
            those hold their role whatever the cap says. Nothing is broken and
            nobody has lost access; the role simply cannot be granted again until
            it is back within its seats.
          </p>
        </div>
      )}

      <section className="mb-8 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-black tracking-tight">Invite a user</h2>
        <p className="mt-1 text-sm text-muted">
          Invited users sign in with Google. Only listed (or env allow-listed)
          emails may access the dashboard — everyone else is rejected at sign-in.
          You can invite by email, or by <code className="font-mono">@username</code>{" "}
          if they already play here.
        </p>
        <form
          action={addAdminAction}
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        >

          <label className="block flex-1 text-sm font-semibold text-foreground">
            Email or @username
            {/* Deliberately `type="text"`: `type="email"` makes the browser
                refuse to submit `@alice` at all, so the server would never get
                the chance to resolve it. Validation lives in
                `parseAdminIdentifier`, which has to run server-side anyway. */}
            <input
              name="email"
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="teammate@example.com or @alice"
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>
          {/* The role is chosen AT INVITE rather than granted first and
              corrected afterwards. Inviting somebody as a full admin and then
              demoting them leaves a window — usually a day, sometimes longer —
              in which they hold access nobody meant to give them. */}
          <label className="block text-sm font-semibold text-foreground sm:w-56">
            Role
            {/* `?? undefined` for the every-role-full case: an explicit `null`
                would make this a controlled select with no value, and React
                would warn about a value prop without an onChange. The form is
                disabled in that state anyway, so there is nothing to control. */}
            <select
              name="role"
              defaultValue={defaultRole ?? undefined}
              disabled={defaultRole === null}
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:bg-surface-2"
            >
              {ROLES.map((role) => (
                <option
                  key={role}
                  value={role}
                  disabled={isRoleFull(seats, role)}
                >
                  {ROLE_LABEL[role]}
                  {isRoleFull(seats, role) ? " (full)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={defaultRole === null}
            className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-muted disabled:hover:bg-muted"
          >
            Add user
          </button>
        </form>
        {/* The seat count sits ON the hint rather than in a summary of its own.
            The two answer one question between them — what this role grants and
            whether it can be granted — and a reader choosing a role should not
            have to assemble that from two places. */}
        <ul className="mt-4 space-y-1 text-xs text-muted">
          {ROLES.map((role) => (
            <li key={role}>
              <span className="font-bold text-foreground">{ROLE_LABEL[role]}</span>{" "}
              — {ROLE_HINT[role]}.{" "}
              <span
                className={
                  isRoleFull(seats, role)
                    ? "font-semibold text-amber-700"
                    : undefined
                }
              >
                {seatSummary(seats, role)}
                {isRoleFull(seats, role) ? " — full" : ""}
              </span>
            </li>
          ))}
        </ul>
        {defaultRole === null && (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Every seat is taken ({totalSeats(seats.limits)} in total). Remove
            somebody below before inviting anyone else, or raise a limit in{" "}
            <Link href="/dashboard/users/settings" className="underline">
              settings
            </Link>
            .
          </p>
        )}
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
            Invite a user above, or sign in with an env allow-listed address.
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
                            {ROLE_LABEL[user.role]}
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
                          <UserRowActions
                            email={user.email}
                            role={user.role}
                            seats={seats}
                            connectors={connectorsFor(connectors, user.email)}
                          />
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
