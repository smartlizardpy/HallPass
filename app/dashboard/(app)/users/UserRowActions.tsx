"use client";

/**
 * Per-row user actions, collapsed behind a single icon.
 *
 * The Users table previously laid the role-select + Save + Remove controls out
 * INLINE in every row, which made each row very wide — wide enough to push later
 * columns (e.g. "Last sign-in") into horizontal overflow. This component replaces
 * that sprawl with one compact icon button that opens a modal holding the same
 * controls, so the table stays narrow and every column is visible.
 *
 * It is a client component only because the modal needs open/close state and
 * Esc/backdrop dismissal. The mutations themselves are unchanged: the two forms
 * still post to the existing `setRoleAction` / `removeUserAction` server actions
 * (imported and used directly as form `action`s), which redirect back with the
 * usual `?ok`/`?error` banner — that full-page navigation also dismisses the
 * modal, so there is no client state to reconcile after a write.
 *
 * Locked env super admins never render this control (the server page shows a
 * "Locked" label instead), and the actions reject them server-side regardless.
 *
 * SEATS. Each role is capped (`ROLE_SEATS`), so a full role is disabled in the
 * select here exactly as it is in the invite form — with one deliberate
 * exception: THIS ROW'S CURRENT ROLE stays selectable even when its seats are
 * full, because the person occupies one of those seats. Disabling it would empty
 * the select of the value it is showing, so the control would open on a role the
 * user does not hold and "Save role" would quietly move them.
 *
 * The seat counts arrive as a prop rather than being read here: this is a client
 * island, the server component has already counted for the page, and a count
 * fetched separately could disagree with the one rendered a few pixels above.
 * They are a snapshot — seats can fill while the modal is open — so this is UX,
 * and `setRole` refuses inside the statement that writes.
 *
 * CONNECTORS sit between the two forms, which is where the question gets asked:
 * a super admin is deciding what to do with an account, and what that account
 * has plugged into HallPass belongs to that decision rather than to a separate
 * trip to `/dashboard/mcp`. It is a READ-ONLY panel — revoking lives on that
 * screen, which can say which grant is which and when each was last used, and
 * duplicating a destructive control in a dialog that already holds one is how
 * people revoke the wrong thing. The counts arrive as a prop for the same
 * reason the seats do, and `null` (rather than zero) is how a failed read
 * reaches here, because "nothing is connected" is a fact and "we could not ask"
 * is not.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { setRoleAction, removeUserAction } from "./actions";
import type { Role } from "@/app/lib/dashboard-users";
import type { ConnectorSummary } from "@/app/lib/mcp/oauth/connectors";
import {
  ROLES,
  ROLE_HINT,
  ROLE_LABEL,
  isRoleFull,
  seatSummary,
  type Seats,
} from "@/app/lib/permissions";

/**
 * The read-only "what has this account plugged in" panel.
 *
 * Three states, and the third is the one usually forgotten: some connections,
 * none at all, and "the read failed" — which arrives as `null` and must not be
 * drawn as a zero. A confident 0 assembled out of an unreachable database is
 * the worst of the three, because it is the one a super admin would act on.
 *
 * The number is grants, not names: approving Claude on a laptop and again on a
 * phone is two credentials that both work. The chips collapse that back to one
 * name carrying a ×2, so the panel is honest about both readings at once.
 */
function ConnectorPanel({ connectors }: { connectors: ConnectorSummary | null }) {
  return (
    <section aria-label="Connectors">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground">Connectors</h4>
        {/* The panel deliberately cannot revoke; this is where that lives. */}
        <Link
          href="/dashboard/mcp"
          className="text-xs font-bold text-brand transition hover:text-brand-600"
        >
          Manage →
        </Link>
      </div>

      {connectors === null ? (
        <p className="mt-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-xs text-muted">
          Connections could not be read — the database is unreachable. This is
          not a claim that there are none.
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
            <span
              aria-hidden
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-white text-brand"
            >
              {/* A plug: the one icon nobody needs a label for. */}
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 3v5M15 3v5" />
                <path d="M6 8h12v3.5A6 6 0 0 1 6 11.5V8Z" />
                <path d="M12 17.5V21" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-2xl font-black leading-none tabular-nums text-foreground">
                {connectors.connections}
              </p>
              <p className="mt-1 text-xs text-muted">
                {connectors.connections === 1
                  ? "app connected to this account"
                  : "apps connected to this account"}
              </p>
            </div>
          </div>

          {connectors.apps.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {connectors.apps.map((app) => (
                <li
                  key={app.name}
                  className="rounded-full border border-border bg-white px-2.5 py-1 text-[11px] font-bold text-foreground"
                >
                  {app.name}
                  {/* Two approvals of one app, said once rather than twice. */}
                  {app.count > 1 && (
                    <span className="ml-1 font-semibold text-muted">
                      ×{app.count}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted">
              They have not approved any app to read HallPass analytics.
            </p>
          )}

          {/* Registering a client is not connecting one, so it is a separate
              sentence rather than a separate number on the card. */}
          {connectors.manualClients > 0 && (
            <p className="mt-2 text-xs text-muted">
              Also registered{" "}
              <span className="font-bold text-foreground">
                {connectors.manualClients}
              </span>{" "}
              {connectors.manualClients === 1 ? "connector" : "connectors"} by
              hand.
            </p>
          )}

          {/* The one thing removal does NOT do, said next to the button that
              does it: the role check below stops these working at once, but the
              approvals outlive the account and come back with a re-invite. */}
          {connectors.connections > 0 && (
            <p className="mt-2 text-xs text-muted">
              Removing this user blocks these straight away, but the approvals
              stay on record — revoke them to end them for good.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function UserRowActions({
  email,
  role,
  seats,
  connectors,
}: {
  email: string;
  role: Role;
  seats: Seats;
  /** What this account has connected, or `null` when that read failed. */
  connectors: ConnectorSummary | null;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // While open: Esc closes, and the underlying page can't scroll behind the
  // modal. Focus the close button so keyboard users land inside the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  /**
   * Can this row be moved TO `value`?
   *
   * The role they already hold is always offered — they are sitting in one of
   * that role's seats, so counting it against them would remove the select's own
   * current value from the list.
   */
  const selectable = (value: Role) => value === role || !isRoleFull(seats, value);

  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Manage ${email}`}
        title="Manage"
        className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-white text-muted transition hover:bg-surface-2 hover:text-foreground"
      >
        {/* Vertical kebab — the conventional "row actions" affordance. */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Manage ${email}`}
        >
          {/* Backdrop — click to dismiss. */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/40"
          />

          {/* Dialog card. */}
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-white p-6 text-left shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-black tracking-tight text-foreground">
                  Manage access
                </h3>
                <p className="mt-0.5 truncate text-sm text-muted">{email}</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-foreground"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/* Role -------------------------------------------------------- */}
            <form action={setRoleAction} className="mt-5">
              <input type="hidden" name="email" value={email} />
              <label className="block text-sm font-semibold text-foreground">
                Role
                {/* Options come from the ladder itself, not from two literals
                    written here. Those literals are why a third role could be
                    stored, displayed and enforced everywhere while remaining
                    ungrantable from the one screen that grants roles. */}
                <select
                  name="role"
                  defaultValue={role}
                  className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
                >
                  {ROLES.map((value) => (
                    <option
                      key={value}
                      value={value}
                      disabled={!selectable(value)}
                    >
                      {ROLE_LABEL[value]}
                      {selectable(value) ? "" : " (full)"}
                    </option>
                  ))}
                </select>
              </label>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {ROLES.map((value) => (
                  <li key={value}>
                    <span className="font-bold text-foreground">
                      {ROLE_LABEL[value]}
                    </span>{" "}
                    — {ROLE_HINT[value]}.{" "}
                    <span
                      className={
                        isRoleFull(seats, value)
                          ? "font-semibold text-amber-700"
                          : undefined
                      }
                    >
                      {seatSummary(seats, value)}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="submit"
                className="mt-3 w-full rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600"
              >
                Save role
              </button>
            </form>

            <div className="my-5 h-px bg-border" />

            {/* Connectors -------------------------------------------------- */}
            <ConnectorPanel connectors={connectors} />

            <div className="my-5 h-px bg-border" />

            {/* Danger ------------------------------------------------------ */}
            <form action={removeUserAction}>
              <input type="hidden" name="email" value={email} />
              <p className="text-sm text-muted">
                Remove this user from the dashboard. They lose access on their next
                request and can be re-invited later.
              </p>
              <button
                type="submit"
                className="mt-3 w-full rounded-full border border-red-200 bg-red-50 px-5 py-2 text-sm font-bold text-red-700 transition hover:bg-red-100"
              >
                Remove from dashboard
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
