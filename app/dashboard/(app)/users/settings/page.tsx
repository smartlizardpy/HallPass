/**
 * HallPass dashboard — user settings (super-admin only).
 *
 * A sibling of `/dashboard/users` rather than a panel on it, because the two
 * answer different questions: that page is about PEOPLE (who holds a role, who
 * should stop), this one is about POLICY (how many of each there may be). The
 * Users page states the limits and links here; this page is where they change.
 *
 * Guarded the same way and for the same reason — `requireRole("super_admin")`
 * fails closed, redirecting a plain admin to their own home. The matching action
 * re-asserts it, so the guard here is defence in depth rather than the boundary.
 *
 * ── WHY THE CURRENT USAGE IS SHOWN BESIDE EACH FIELD ────────────────────────
 * A limit is only a decision if the person setting it can see what it will do.
 * "3" typed into a box is meaningless; "3, and two people hold it" is a choice,
 * and "3, and five people hold it" is a warning that the save will put the role
 * over capacity. Lowering below the holders is ALLOWED — nobody is demoted by
 * it — so the number that matters is the one the form does not otherwise show.
 *
 * The usage read is wrapped: the limits are always readable (an unreadable
 * setting falls back to its default), but the COUNT needs the database, and a
 * settings form should still be usable when the user table is not.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { countRoleSeats } from "@/app/lib/dashboard-users";
import {
  ROLES,
  ROLE_HINT,
  ROLE_LABEL,
  SEAT_MAX,
  SEAT_MIN,
  DEFAULT_ROLE_SEATS,
  emptySeatCounts,
  totalSeats,
  type SeatCounts,
} from "@/app/lib/permissions";
import { readSeatLimits } from "@/app/lib/role-seats";
import { setSeatLimitsAction } from "./actions";
import { DashHeader } from "../../_ui/DashHeader";

export const metadata: Metadata = {
  title: "User settings",
  description: "Limits on who can hold a HALLPASS dashboard role.",
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

export default async function UserSettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole("super_admin");

  const params = await searchParams;
  const ok = asString(params.ok);
  const error = asString(params.error);

  const limits = await readSeatLimits();

  let taken: SeatCounts = emptySeatCounts();
  let countError = false;
  try {
    taken = await countRoleSeats();
  } catch {
    countError = true;
  }

  return (
    <>
      <DashHeader
        title="User settings"
        subtitle="How many people may hold each dashboard role."
        action={
          <Link
            href="/dashboard/users"
            className="text-sm font-semibold text-brand hover:text-brand-600"
          >
            ← Back to users
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

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-black tracking-tight">Seat limits</h2>
        <p className="mt-1 text-sm text-muted">
          A grant that would take a role past its limit is refused — on the
          invite form, on a role change, and in the action behind both. Nobody is
          ever demoted by a limit: lowering one below the people already holding
          the role leaves them exactly as they are, and simply stops the role
          being granted again until it is back within its seats.
        </p>

        <form action={setSeatLimitsAction} className="mt-5 space-y-4">
          {ROLES.map((role) => {
            const held = taken[role];
            const over = !countError && held > limits[role];
            return (
              <div
                key={role}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">
                    {ROLE_LABEL[role]}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{ROLE_HINT[role]}</p>
                  <p className="mt-1 text-xs text-muted">
                    {countError ? (
                      "Current usage unavailable (database error)."
                    ) : (
                      <>
                        Currently held by {held}{" "}
                        {held === 1 ? "person" : "people"}.
                      </>
                    )}{" "}
                    Default {DEFAULT_ROLE_SEATS[role]}.
                  </p>
                  {over && (
                    <p className="mt-1 text-xs font-semibold text-amber-700">
                      More people hold this than the limit allows. Nobody has
                      lost access; the role cannot be granted again until it is
                      back within its seats.
                    </p>
                  )}
                </div>
                <label className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">
                  <span className="block">Seats</span>
                  {/* `type="number"` with the same bounds the action enforces.
                      The browser's validation is a convenience — `toSeatLimit`
                      re-checks server-side, because a posted value never has to
                      have come from this input. */}
                  <input
                    name={`seats:${role}`}
                    type="number"
                    inputMode="numeric"
                    min={SEAT_MIN}
                    max={SEAT_MAX}
                    step={1}
                    required
                    defaultValue={limits[role]}
                    className="mt-1 w-28 rounded-lg border border-border bg-surface px-3 py-2 text-base font-bold tabular-nums text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </label>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-sm text-muted">
              {totalSeats(limits)} people may hold a dashboard role in total.
            </p>
            <button
              type="submit"
              className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600"
            >
              Save limits
            </button>
          </div>
        </form>

        <p className="mt-4 text-xs text-muted">
          Between {SEAT_MIN} and {SEAT_MAX} each. Addresses in{" "}
          <code className="font-mono">SUPER_ADMIN_EMAILS</code> are the one
          exception to every limit here: they hold super admin whatever the cap
          says, so that a full table can never lock the last one out. Their row
          still takes a seat.
        </p>
      </section>
    </>
  );
}
