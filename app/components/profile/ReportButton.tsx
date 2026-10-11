"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import {
  NOTE_MAX_CHARS,
  PROFILE_REPORT_REASONS,
  type ProfileReportReason,
} from "@/app/lib/profile-reports/config";

/**
 * The "Report" control for another player — a client island over
 * `POST /api/v1/me/reports`, opening a small modal dialog.
 *
 * WHERE IT IS RENDERED is the caller's decision: `/u/<username>` for any
 * signed-in viewer who is not the owner, and the friends list rows. It is shown
 * on a blocked or private profile too, deliberately: `/u/<username>` already
 * renders a minimal profile to those viewers, so the button reveals nothing the
 * page does not, and hiding it would stop a child reporting the very person they
 * blocked. Nothing here changes what a profile discloses.
 *
 * IT SENDS `publicId`, NEVER an internal id, like `FriendButton`.
 *
 * THE DIALOG is a native `<dialog>` opened with `showModal()`: the browser
 * supplies the focus trap, the inert background, Escape-to-close and the
 * top layer, so none of that is reimplemented here (and none of it can be got
 * subtly wrong). The reason list is a `fieldset` of radios with a `legend`; the
 * outcome is announced through `role="status"` / `role="alert"` regions.
 *
 * RENDERS `null` UNTIL HYDRATED for the reason `FriendButton` documents: a
 * button that exists before its JavaScript does is a button that silently does
 * nothing.
 *
 * COPY. Plain and kid-friendly, and it promises exactly one thing: that a person
 * at HallPass will look at it. It does not promise the player will be told,
 * that anything will happen, or how fast; and it does not say who else is
 * notified (nobody is — the reported player is never told).
 */

const NEVER_CHANGES = () => () => {};
const SERVER_SNAPSHOT = () => false;
const CLIENT_SNAPSHOT = () => true;

type Phase = "idle" | "sending" | "done";

const FAILURE_COPY: Record<string, string> = {
  "rate-limited": "You've sent a lot of reports today. Please try again tomorrow.",
  unavailable: "We couldn't find that player.",
  self: "You can't report yourself.",
  "signed-out": "Please sign in to send a report.",
  down: "Something went wrong on our side. Please try again in a bit.",
};
const GENERIC_FAILURE = "Couldn't send your report. Please try again.";

export function ReportButton({
  publicId,
  displayName,
  variant = "link",
}: {
  /** `players.public_id` — the only identifier that crosses to the client. */
  publicId: string;
  /** From `publicDisplayName()`. Never the Google name. */
  displayName: string;
  /** `link` is a quiet text button (profile page); `small` matches list-row buttons. */
  variant?: "link" | "small";
}) {
  const hydrated = useSyncExternalStore(NEVER_CHANGES, CLIENT_SNAPSHOT, SERVER_SNAPSHOT);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [reason, setReason] = useState<ProfileReportReason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function open() {
    setPhase("idle");
    setReason(null);
    setNote("");
    setError(null);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!reason || phase === "sending") return;
    setPhase("sending");
    setError(null);
    try {
      const res = await fetch("/api/v1/me/reports", {
        method: "POST",
        // Same-origin, cookie-credentialed; the endpoint checks the referrer
        // against the allowlist (`/u/`, `/play/`), so a game frame cannot call it.
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: publicId, reason, note: note.trim() || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      if (res.ok && body.ok) {
        setPhase("done");
        return;
      }
      setError(FAILURE_COPY[body.reason ?? ""] ?? GENERIC_FAILURE);
      setPhase("idle");
    } catch {
      setError("You appear to be offline.");
      setPhase("idle");
    }
  }

  if (!hydrated) return null;

  const trigger =
    variant === "small"
      ? "rounded-full border border-border px-3 py-1.5 text-[12px] font-extrabold text-muted transition hover:text-foreground focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
      : "text-[13px] font-bold text-muted underline-offset-2 transition hover:text-foreground hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 rounded";

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-label={`Report ${displayName}`}
        className={trigger}
      >
        Report
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={`report-title-${publicId}`}
        className="m-auto w-[min(92vw,26rem)] rounded-3xl bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/50"
      >
        {phase === "done" ? (
          <div className="space-y-4 p-6">
            <h2 id={`report-title-${publicId}`} className="text-lg font-black">
              Thanks for telling us
            </h2>
            <p role="status" className="text-sm font-semibold text-foreground-2">
              A person at HallPass will look at your report. You don&apos;t need to do
              anything else. If you ever feel unsafe, tell a grown-up you trust.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={close}
                className="rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={send} className="space-y-4 p-6">
            <h2 id={`report-title-${publicId}`} className="text-lg font-black">
              Report {displayName}
            </h2>
            <p className="text-sm font-semibold text-foreground-2">
              Tell us what&apos;s wrong. A person at HallPass will look at it.
              They won&apos;t be told it was you.
            </p>

            <fieldset className="space-y-2">
              <legend className="mb-1 text-[13px] font-black text-foreground">
                What&apos;s the problem?
              </legend>
              {PROFILE_REPORT_REASONS.map((r) => (
                <label
                  key={r.value}
                  className="flex cursor-pointer items-center gap-3 rounded-2xl bg-surface-2 px-4 py-2.5 text-sm font-bold has-[:checked]:ring-2 has-[:checked]:ring-brand"
                >
                  <input
                    type="radio"
                    name={`report-reason-${publicId}`}
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="h-4 w-4 accent-brand"
                  />
                  {r.label}
                </label>
              ))}
            </fieldset>

            <div>
              <label htmlFor={`report-note-${publicId}`} className="text-[13px] font-black">
                Anything else we should know? <span className="font-semibold text-muted">(optional)</span>
              </label>
              <textarea
                id={`report-note-${publicId}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={NOTE_MAX_CHARS}
                rows={3}
                className="mt-1 w-full resize-none rounded-2xl border border-border bg-surface-2 px-4 py-2.5 text-sm font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
              />
              <p className="mt-1 text-right text-[11px] font-semibold text-muted">
                {note.length}/{NOTE_MAX_CHARS}
              </p>
            </div>

            {error && (
              <p role="alert" className="text-[13px] font-bold text-red-700 dark:text-red-300">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-full px-4 py-2.5 text-sm font-extrabold text-muted transition hover:text-foreground focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!reason || phase === "sending"}
                className="rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
              >
                {phase === "sending" ? "Sending…" : "Send report"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
