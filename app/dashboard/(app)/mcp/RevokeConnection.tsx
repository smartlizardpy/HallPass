"use client";

/**
 * The revoke button, behind a confirmation.
 *
 * A client component only because the modal needs open/close state and Esc
 * dismissal — the same shape and the same reasoning as
 * `users/UserRowActions.tsx`. The mutation is unchanged: the form still posts
 * to `revokeConnectionAction`, which redirects back with the usual `?ok` /
 * `?error` banner, and that full-page navigation dismisses the modal, so there
 * is no client state to reconcile after the write.
 *
 * It confirms rather than acting on one click because revoking is irreversible
 * in the way that matters: the token cannot be un-revoked, and the only way
 * back is to reconnect from the client and approve again. That is a minute of
 * somebody's time, not a catastrophe — hence a confirmation and not a typed
 * phrase.
 */

import { useEffect, useRef, useState } from "react";
import { revokeConnectionAction } from "./actions";

export function RevokeConnection({
  grantId,
  clientName,
  scope = "own",
  owner,
}: {
  grantId: string;
  clientName: string;
  /** `all` is the super-admin button that may reach past its own account. */
  scope?: "own" | "all";
  /** Whose connection this is, shown when revoking somebody else's. */
  owner?: string;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-border px-3 py-1 text-xs font-bold text-zinc-700 hover:bg-surface-2"
      >
        Revoke
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Revoke ${clientName}`}
            className="w-full max-w-sm rounded-xl border border-border bg-surface p-6"
          >
            <h2 className="text-lg font-black tracking-tight">
              Revoke {clientName}?
            </h2>
            <p className="mt-2 text-sm text-muted">
              {owner ? (
                <>
                  This connection belongs to{" "}
                  <span className="font-semibold text-foreground">{owner}</span>. Its
                  next request will be refused.
                </>
              ) : (
                <>
                  Its next request will be refused. You can connect again from the
                  app whenever you like — it will ask you to approve it afresh.
                </>
              )}
            </p>
            <form action={revokeConnectionAction} className="mt-5 flex gap-2">
              <input type="hidden" name="grantId" value={grantId} />
              <input type="hidden" name="scope" value={scope} />
              <button
                type="submit"
                className="flex-1 rounded-full bg-brand px-4 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
              >
                Revoke
              </button>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-full border border-border bg-white px-4 py-2 text-sm font-bold text-zinc-700 hover:bg-surface-2"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
