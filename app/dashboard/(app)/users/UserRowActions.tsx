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
 */

import { useEffect, useRef, useState } from "react";
import { setRoleAction, removeUserAction } from "./actions";
import type { Role } from "@/app/lib/dashboard-users";

export function UserRowActions({ email, role }: { email: string; role: Role }) {
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
                <select
                  name="role"
                  defaultValue={role}
                  className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
                >
                  <option value="admin">Admin</option>
                  <option value="super_admin">Super admin</option>
                </select>
              </label>
              <button
                type="submit"
                className="mt-3 w-full rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600"
              >
                Save role
              </button>
            </form>

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
